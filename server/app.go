package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/julienschmidt/httprouter"
	"github.com/rs/cors"
	"io"
	"net"
	"net/http"
	"nhooyr.io/websocket"
	"regexp"
	"strconv"
	"time"
)

type contentModel struct {
	Content  string
	Filename string
	RoomID   string
}

type roomModel struct {
	Language string
}

type containerDetails struct {
	ID                 string
	connection         types.HijackedResponse
	runner             net.Conn
	bufReader          *bufio.Reader
	runnerReaderActive bool
}

type eventConfig struct {
	count int
}

type room struct {
	wsockets         []*websocket.Conn
	lang             string
	echo             bool
	container        *containerDetails
	eventSubscribers map[string]func(eventConfig)
}

func (r *room) emit(event string, config eventConfig) {
	if callback, ok := r.eventSubscribers[event]; ok {
		callback(config)
	}
}

func (r *room) setEventListener(event string, callback func(config eventConfig)) {
	if r.eventSubscribers == nil {
		r.eventSubscribers = make(map[string]func(eventConfig))
	}
	r.eventSubscribers[event] = callback
}

func (r *room) removeEventListener(event string) {
	delete(r.eventSubscribers, event)
}

var cli *client.Client
var rooms = make(map[string]*room)

func initClient() {
	var err error
	cli, err = client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		panic(err)
	}
}

func generateRoomID() string {
	int64ID := time.Now().UnixNano()
	return strconv.FormatInt(int64ID, 10)
}

func getLang(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	lang := rooms[roomID].lang

	w.Header().Set("Content-Type", "text/plain;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(lang))
}

func createRoom(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	var rm roomModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		fmt.Println("err reading json: ", err)
	}
	err = json.Unmarshal(body, &rm)
	if err != nil {
		fmt.Println("err while trying to unmarshal: ", err)
	}
	fmt.Println("*************rm.Language: ", rm.Language)
	roomID := generateRoomID()
	fmt.Println("************roomID: ", roomID)

	room := room{
		lang:      rm.Language,
		container: &containerDetails{},
	}
	rooms[roomID] = &room
	startContainer(rm.Language, roomID)

	w.Header().Set("Content-Type", "text/plain;charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(roomID))
}

func openWs(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5000", "codeconnected.dev"},
	})
	if err != nil {
		fmt.Println("error in opening websocket: ", err)
	}
	defer ws.Close(websocket.StatusInternalError, "deferred close")

	// Append websocket to room socket list
	rooms[roomID].wsockets = append(rooms[roomID].wsockets, ws)

	// Websocket receive loop
	for {
		// Receive command
		_, message, err := ws.Read(context.Background())
		fmt.Println("message: ", message)
		if err != nil {
			fmt.Println("error receiving message: ", err, " ", time.Now().String())
			// Todo -- I should try to recover after this (reopen ws?)
			break
		}

		fmt.Printf("Command received: %s\n", message)
		if string(message) != "KEEPALIVE" {
			sendToContainer(message, roomID)
		}
	}
}

func startRunnerReader(roomID string) {
	room := rooms[roomID]
	cn := room.container
	// There should only be one runner reader per container
	if cn.runnerReaderActive {
		return
	}
	cn.runnerReaderActive = true
	// Wait time before checking whether prompt is ready, in ms
	promptWait := 200
	fakeTermBuffer := []byte{}
	// number of newlines (\n) after a prompt
	newlineCount := 0
	ansiEscapes, err := regexp.Compile("\x1B(?:[@-Z\\-_]|[[0-?]*[ -/]*[@-~])")
	if err != nil {
		fmt.Println("Regexp compilation error: ", err)
	}
	promptTermination, err := regexp.Compile("> $")
	if err != nil {
		fmt.Println("Regexp compilation error: ", err)
	}
	go func() {
		fmt.Println("Reading from connection\n")
		var timer *time.Timer
		for {
			// Check for 8-byte docker multiplexing header and discard
			// if present
			peek, err := cn.bufReader.Peek(1)
			// Peek will fail if connection is closed
			if err != nil {
				fmt.Println("peek error: ", err)
				break
			}
			// Header will begin with ascii value 1
			if peek[0] == 1 {
				// Discard the header
				num, err := cn.bufReader.Discard(8)
				if err != nil {
					fmt.Println("error in discarding header: ", err)
				}
				fmt.Println("header bytes discarded: ", num)
			}

			ru, _, err := cn.bufReader.ReadRune()
			byteSlice := []byte(string(ru))
			if err == io.EOF {
				fmt.Println("EOF hit in runner output")
				break
			}
			if err != nil {
				// Runner not connected
				fmt.Println("runner read error: ", err, time.Now().String())
				break
			}

			if string(ru) == "\n" {
				fmt.Println("*********newline in output*********")
				newlineCount++
				room.emit("newline", eventConfig{count: newlineCount})
				fmt.Println("newlineCount: ", newlineCount)
			}

			// Add char to fake terminal buffer
			fakeTermBuffer = append(fakeTermBuffer, byteSlice...)

			if bytes.HasSuffix(fakeTermBuffer, []byte("START")) {
				room.emit("startOutput", eventConfig{})
				// Skip over current character, with is that last
				// character in start sequence
				continue
			}

			// If there is a break in data being sent (e.g., if a
			// command has finished executing), check for prompt
			if timer != nil {
				_ = timer.Stop()
			}
			timer = time.NewTimer(time.Duration(promptWait) * time.Millisecond)
			go func() {
				select {
				case <-timer.C:
					// Remove ansi escape codes from fakeTermBuffer
					fakeTermBuffer = ansiEscapes.ReplaceAll(fakeTermBuffer, []byte(""))
					// Check whether fakeTermBuffer ends with prompt termination
					if promptTermination.Match(fakeTermBuffer) {
						room.emit("promptReady", eventConfig{})
						fmt.Println("Matched prompt termination")
						fakeTermBuffer = []byte{}
						newlineCount = 0
					}
				case <-time.After(time.Duration(promptWait+50) * time.Millisecond):
					return
				}
			}()

			if room.echo == true {
				writeToWebsockets(byteSlice, roomID)
			}
		}
	}()
	fmt.Println("closing runner reader")
	cn.runnerReaderActive = false
}

// TODO: (but maybe not right here): when there are no more
// websocket connections (or after a certain time out with no
// activity on any of the wsocket connections in a room), terminate all connections for that room
// and terminate container
func writeToWebsockets(byteSlice []byte, roomID string) {
	fmt.Println("writing to wsockets: ", byteSlice, string(byteSlice))
	fmt.Println("number of wsocket conns: ", len(rooms[roomID].wsockets))
	var newList []*websocket.Conn
	for _, ws := range rooms[roomID].wsockets {
		fmt.Println("********Writing to websocket*********")
		err := ws.Write(context.Background(), websocket.MessageText, byteSlice)
		// If websocket is no longer available, leave it out of new list
		if err != nil {
			fmt.Println("ws write err: ", "byteSlice", byteSlice, "; err: ", err)
			ws.Close(websocket.StatusInternalError, "websocket no longer available")
			continue
		}
		newList = append(newList, ws)
	}
	rooms[roomID].wsockets = newList
}

func sendToContainer(message []byte, roomID string) {
	fmt.Println("Sending message to container")
	cn := rooms[roomID].container
	lang := rooms[roomID].lang

	tries := 0
	for tries < 5 {
		// Back off on each failed connection attempt
		time.Sleep(time.Duration(tries/2) * time.Second)
		_, err := cn.runner.Write(message)
		if err == nil {
			fmt.Printf("Payload bytes: %#v\n\n", message)
			break
		}
		fmt.Println("runner write error: ", err)
		// Reestablish connection
		// FIXME: This part doesn't seem to be working  -- connection
		// is not being reestablished after: runner write
		// error: write tcp 172.22.0.3:58204->5.161.62.82:2376:
		// write: broken pipe
		// It seems to be reconnecting... i.e., it only tries once
		// and doesn't give any error messages, but it doesn't
		// actually reconnect... ***or maybe it does and I also have
		// to restart the runner reader...
		// which happens, e.g. when I leave the computer overnight to
		// sleep
		// ATTEMPTED FIX: Now restarting runner reader, too... Does
		// this work now?
		fmt.Println("trying to reestablish connection")
		// TODO: Do I have to find out the status of connection and
		// (if active) close it before opening it again?
		err = openLanguageConnection(lang, roomID)
		if err != nil {
			fmt.Println(err)
		}
		tries++
	}

	// If unable to connect
	if tries == 5 {
		panic(errors.New("unable to reconnect to runner"))
	}
}

func saveContent(w http.ResponseWriter, r *http.Request, p httprouter.Params) {

	var cm contentModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		panic(err)
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		panic(err)
	}
	tarBuffer, err := makeTarball([]byte(cm.Content), cm.Filename)
	if err != nil {
		panic(err)
	}

	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		panic(err)
	}

	cn := rooms[cm.RoomID].container

	// Copy contents of user program to container.
	err = cli.CopyToContainer(ctx, cn.ID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	if err != nil {
		panic(err)
	}

	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Successfully wrote code to container"))
}

// TODO: Move error handling to createRoom (return error here
// along with containerDetails)
func startContainer(lang, roomID string) {
	room := rooms[roomID]
	cn := room.container
	ctx := context.Background()
	cmd := []string{"bash"}
	resp, err := cli.ContainerCreate(ctx, &container.Config{
		// Don't specify the non-root user here, since the entrypoint
		// needs to be root to start up Postgres
		Image:        "myrunner",
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: false,
		Tty:          true,
		OpenStdin:    true,
		Cmd:          cmd,
	}, nil, nil, nil, "")
	if err != nil {
		panic(err)
	}
	if err := cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
		panic(err)
	}
	fmt.Println("Setting new container id to: ", resp.ID)
	cn.ID = resp.ID
	// Sql container needs a slight pause to create user
	// This will give openLanguageConnection a better chance of
	// correctly opening the connection on the first try
	if lang == "sql" {
		time.Sleep(2 * time.Second)
	}
	err = openLanguageConnection(lang, roomID)
	if err != nil {
		fmt.Println(err)
	}
	room.echo = true
}

func switchLanguage(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// TODO: Switch to an existing container with the language in
	// question if already open
	queryValues := r.URL.Query()
	lang := queryValues.Get("lang")
	roomID := queryValues.Get("roomID")

	room := rooms[roomID]
	cn := room.container
	room.lang = lang
	// TODO: Check if connection is open before closing it
	cn.connection.Close()
	err := openLanguageConnection(lang, roomID)
	if err != nil {
		fmt.Println(err)
	}

	w.Header().Set("Content-Type", "text/plain;charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Success"))
}

func openLanguageConnection(lang, roomID string) error {
	room := rooms[roomID]
	// Number of attempts to make
	maxTries := 5
	tries := 0
	// Wait until prompt is ready
	waitTime := 3000
	success := make(chan struct{})
	room.setEventListener("promptReady", func(config eventConfig) {
		close(success)
		room.removeEventListener("promptReady")
	})
loop:
	for {
		attemptLangConn(lang, roomID)
		select {
		case <-success:
			return nil
		case <-time.After(time.Duration(waitTime) * time.Millisecond):
			tries++
			if tries >= maxTries {
				break loop
			}
		}
	}
	return errors.New("Unable to open language connection (could not get prompt)")
}

func attemptLangConn(lang, roomID string) {
	room := rooms[roomID]
	cn := room.container
	var cmd []string
	switch lang {
	case "javascript":
		cmd = []string{"custom-node-launcher"}
	case "ruby":
		cmd = []string{"pry"}
	case "sql":
		cmd = []string{"psql"}
	case "bash":
		cmd = []string{"bash"}
	}

	ctx := context.Background()
	execOpts := types.ExecConfig{
		User:         "codeuser",
		Tty:          true,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: false,
		WorkingDir:   "/home/codeuser",
		Cmd:          cmd,
	}

	resp, err := cli.ContainerExecCreate(ctx, cn.ID, execOpts)
	if err != nil {
		fmt.Println("unable to create exec process: ", err)
	}

	cn.connection, err = cli.ContainerExecAttach(ctx,
		resp.ID, types.ExecStartCheck{})
	if err != nil {
		fmt.Println("unable to start/attach to exec process: ", err)
	}

	cn.runner = cn.connection.Conn
	cn.bufReader = bufio.NewReader(cn.connection.Reader)
	startRunnerReader(roomID)
}

// TODO: Make sure repl is at prompt before running code
// TODO: Make sure prompt is in correct repl before running code
// (maybe by running a certain command and examining the output)
// TODO: No.2: If repl is not at prompt, get is there (by exiting
// and re-entering?)
func runFile(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	room := rooms[roomID]
	cn := room.container
	lang := queryValues.Get("lang")
	linesOfCode := queryValues.Get("lines")
	writeToWebsockets([]byte("Running your code...\r\n"), roomID)
	room.echo = false
	switch lang {
	case "ruby":
		cn.runner.Write([]byte("exec $0\n")) // reset repl
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			cn.runner.Write([]byte("puts 'ST' + 'ART'; " + "load 'code.rb';\n"))
		})
		room.setEventListener("startOutput", func(config eventConfig) {
			room.removeEventListener("startOutput")
			room.echo = true
		})
	case "javascript":
		cn.runner.Write([]byte(".clear\n"))
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			// Delete two previous lines from remote terminal
			cn.runner.Write([]byte(".load code.js\n"))

			// Turn echo back on right before output begins
			// Set this event listener after the promptReady event
			// fires to ensure that only newlines after the prompt are
			// counted
			room.setEventListener("newline", func(config eventConfig) {
				lines, err := strconv.Atoi(linesOfCode)
				if err != nil {
					fmt.Println("strconv error: ", err)
				}
				if config.count == lines+1 {
					room.echo = true
					room.removeEventListener("newline")
				}
			})
		})
	}
}

func main() {
	initClient()
	router := httprouter.New()
	router.POST("/api/savecontent", saveContent)
	// FIXME: Should this be a POST (is it really idempotent)?
	router.GET("/api/openws", openWs)
	router.POST("/api/createroom", createRoom)
	router.GET("/api/getlang", getLang)
	router.POST("/api/switchlanguage", switchLanguage)
	router.POST("/api/runfile", runFile)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("Starting server on port %d\n", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

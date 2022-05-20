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

type room struct {
	wsockets  []*websocket.Conn
	lang      string
	container *containerDetails
}

type eventConfig struct {
	count int
}

var cli *client.Client
var echo = true
var eventSubscribers = make(map[string]func(eventConfig))
var rooms = make(map[string]*room)

// var attachOpts = types.ContainerAttachOptions{
//	Stream: true, // This apparently needs to be true for Conn.Write to work
//	Stdin:  true,
//	Stdout: true,
//	Stderr: false,
// }

func initClient() {
	var err error
	cli, err = client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		panic(err)
	}
}

// TODO -- Do I even need this now that I have
// openLanguageConnection and execInContainer?
// func openRunnerConn() {
//	var err error
//	fmt.Println("connecting to container id: ", containerID)
//	connection, err = cli.ContainerAttach(context.Background(), containerID, attachOpts)
//	if err != nil {
//		fmt.Println("error in getting new connection: ", err)
//		panic(err)
//	}
//	runner = connection.Conn
//	lang = "bash"
// }

func generateRoomID() string {
	int64ID := time.Now().UnixNano()
	return strconv.FormatInt(int64ID, 10)
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
		container: startContainer(rm.Language),
	}
	rooms[roomID] = &room
	// TODO: make this a room method
	startRunnerReader(room.container, roomID)

	w.Header().Set("Content-Type", "text/plain;charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(roomID))
}

func openWs(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")

	// fmt.Println("number of websocket conns: ", len(wsockets))
	// if len(wsockets) == 0 {
	// 	// fmt.Sprintf("Starting initial container (%s)\n", language)
	// 	fmt.Println("Starting initial container")
	// 	startContainer(lang)
	// }

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5000", "codeconnected.dev"},
	})
	if err != nil {
		fmt.Println("error in opening websocket: ", err)
	}
	defer ws.Close(websocket.StatusInternalError, "deferred close")

	// Append websocket to room socket list
	rooms[roomID].wsockets = append(rooms[roomID].wsockets, ws)
	fmt.Println("number of wsocket conns: ", rooms[roomID].wsockets)

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
			sendToContainer(message, rooms[roomID].container, rooms[roomID].lang)
		}
	}
}

func startRunnerReader(cn *containerDetails, roomID string) {
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
				emit("newline", eventConfig{count: newlineCount})
				fmt.Println("newlineCount: ", newlineCount)
			}

			// Add char to fake terminal buffer
			fakeTermBuffer = append(fakeTermBuffer, byteSlice...)

			if bytes.HasSuffix(fakeTermBuffer, []byte("START")) {
				emit("startOutput", eventConfig{})
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
						emit("promptReady", eventConfig{})
						fmt.Println("Matched prompt termination")
						fakeTermBuffer = []byte{}
						newlineCount = 0
					}
				case <-time.After(time.Duration(promptWait+50) * time.Millisecond):
					return
				}
			}()

			if echo == true {
				writeToWebsockets(byteSlice, roomID)
			}
		}
	}()
	fmt.Println("closing runner reader")
	cn.runnerReaderActive = false
}

func writeToWebsockets(byteSlice []byte, roomID string) {
	fmt.Println("writing to wsockets: ", byteSlice, string(byteSlice))
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

func sendToContainer(message []byte, cn *containerDetails, lang string) {
	fmt.Println("Sending message to container")

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
		fmt.Println("trying to reestablish connection")
		// TODO: Do I have to find out the status of connection and
		// (if active) close it before opening it again?
		cn.connection, cn.runner, cn.bufReader = openLanguageConnection(cn.ID, lang)
		tries++
	}

	// If unable to connect
	if tries == 5 {
		panic(errors.New("unable to reconnect to runner"))
	}
}

func saveContent(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// var cm contentModel
	// body, err := io.ReadAll(r.Body)
	// if err != nil {
	// 	panic(err)
	// }
	// err = json.Unmarshal(body, &cm)
	// if err != nil {
	// 	panic(err)
	// }
	// tarBuffer, err := makeTarball([]byte(cm.Content), cm.Filename)
	// if err != nil {
	// 	panic(err)
	// }

	// ctx := context.Background()
	// cli, err := client.NewClientWithOpts(client.FromEnv)
	// if err != nil {
	// 	panic(err)
	// }

	// // Copy contents of user program to container.
	// err = cli.CopyToContainer(ctx, containerID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	// if err != nil {
	// 	panic(err)
	// }

	// w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	// w.WriteHeader(http.StatusCreated)
	// w.Write([]byte("Successfully wrote code to container"))
}

// TODO: Move error handling to createRoom (return error here
// along with containerDetails)
func startContainer(lang string) *containerDetails {
	ctx := context.Background()
	cmd := []string{"bash"}
	resp, err := cli.ContainerCreate(ctx, &container.Config{
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
	containerID := resp.ID
	connection, runner, bufReader := openLanguageConnection(containerID, lang)
	return &containerDetails{
		ID:         containerID,
		connection: connection,
		runner:     runner,
		bufReader:  bufReader,
	}
}

func switchLanguage(w http.ResponseWriter, r *http.Request, p httprouter.Params) {

	// connection.Close()
	// queryValues := r.URL.Query()
	// lang := queryValues.Get("lang")

	// // TODO: Need to fix this to work with multiuser system
	// openLanguageConnection(lang)
}

func openLanguageConnection(containerID, lang string) (types.HijackedResponse, net.Conn, *bufio.Reader) {
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

	return execInContainer(containerID, cmd)
}

func execInContainer(containerID string, cmd []string) (types.HijackedResponse, net.Conn, *bufio.Reader) {
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

	resp, err := cli.ContainerExecCreate(ctx, containerID, execOpts)
	if err != nil {
		fmt.Println("unable to create exec process: ", err)
	}

	connection, err := cli.ContainerExecAttach(ctx,
		resp.ID, types.ExecStartCheck{})
	if err != nil {
		fmt.Println("unable to start/attach to exec process: ", err)
	}

	runner := connection.Conn
	bufReader := bufio.NewReader(connection.Reader)

	return connection, runner, bufReader

	// output := make([]byte, 0, 512)
	// // Get 8-byte header of multiplexed stdout/stderr stream
	// // and then read data, and repeat until EOF
	// for {
	//	h := make([]byte, 8)
	//	_, err := connection.Reader.Read(h)
	//	if err == io.EOF {
	//		break
	//	}
	//	if err != nil {
	//		fmt.Println("error in reading header: ", err)
	//	}

	//	// First byte indicates stdout or stderr
	//	// var streamType string
	//	// if h[0] == 2 {
	//	//	streamType = "stderr"
	//	// } else {
	//	//	streamType = "stdout"
	//	// }

	//	// Last 4 bytes represent uint32 size
	//	size := h[4] + h[5] + h[6] + h[7]
	//	b := make([]byte, size)
	//	_, err = connection.Reader.Read(b)
	//	if err == io.EOF {
	//		break
	//	}
	//	if err != nil {
	//		fmt.Println("error in reading output body: ", err)
	//	}

	//	output = append(output, b...)
	// }

	// fmt.Println("output from direct command: ", output)
}

// TODO: Make sure repl is at prompt before running code
// TODO: Make sure prompt is in correct repl before running code
// (maybe by running a certain command and examining the output)
// TODO: No.2: If repl is not at prompt, get is there (by exiting
// and re-entering?)
func runFile(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// queryValues := r.URL.Query()
	// lang := queryValues.Get("lang")
	// linesOfCode := queryValues.Get("lines")
	// writeToWebsockets([]byte("Running your code...\r\n"))
	// echo = false
	// switch lang {
	// case "ruby":
	// 	runner.Write([]byte("exec $0\n")) // reset repl
	// 	setEventListener("promptReady", func(config eventConfig) {
	// 		removeEventListener("promptReady")
	// 		runner.Write([]byte("puts 'ST' + 'ART'; " + "load 'code.rb';\n"))
	// 	})
	// 	setEventListener("startOutput", func(config eventConfig) {
	// 		removeEventListener("startOutput")
	// 		echo = true
	// 	})
	// case "javascript":
	// 	runner.Write([]byte(".clear\n"))
	// 	setEventListener("promptReady", func(config eventConfig) {
	// 		removeEventListener("promptReady")
	// 		// Delete two previous lines from remote terminal
	// 		runner.Write([]byte(".load code.js\n"))

	// 		// Turn echo back on right before output begins
	// 		// Set this event listener after the promptReady event
	// 		// fires to ensure that only newlines after the prompt are
	// 		// counted
	// 		setEventListener("newline", func(config eventConfig) {
	// 			lines, err := strconv.Atoi(linesOfCode)
	// 			if err != nil {
	// 				fmt.Println("strconv error: ", err)
	// 			}
	// 			if config.count == lines+1 {
	// 				echo = true
	// 				removeEventListener("newline")
	// 			}
	// 		})
	// 	})
	// }
}

func emit(event string, config eventConfig) {
	if callback, ok := eventSubscribers[event]; ok {
		callback(config)
	}
}

func setEventListener(event string, callback func(config eventConfig)) {
	eventSubscribers[event] = callback
}

func removeEventListener(event string) {
	delete(eventSubscribers, event)
}

func main() {
	initClient()
	// defer connection.Close()
	router := httprouter.New()
	router.POST("/api/savecontent", saveContent)
	router.GET("/api/openws", openWs)
	router.POST("/api/createroom", createRoom)
	router.GET("/api/switchlanguage", switchLanguage)
	router.GET("/api/runfile", runFile)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("Starting server on port %d\n", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

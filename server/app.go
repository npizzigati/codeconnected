package main

import (
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

// TODO: Can there variables/constants be passed around in a
// context object instead?
var cli *client.Client
var connection types.HijackedResponse
var runner net.Conn
var wsockets []*websocket.Conn
var runnerReaderActive bool
var echo = true
var eventSubscribers = make(map[string]func(eventConfig))
var containerID string
var attachOpts = types.ContainerAttachOptions{
	Stream: true, // This apparently needs to be true for Conn.Write to work
	Stdin:  true,
	Stdout: true,
	Stderr: false,
}

type eventConfig struct {
	count int
}

func initClient() {
	var err error
	cli, err = client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		panic(err)
	}
}

func openRunnerConn() {
	var err error
	fmt.Println("connecting to container id: ", containerID)
	connection, err = cli.ContainerAttach(context.Background(), containerID, attachOpts)
	if err != nil {
		fmt.Println("error in getting new connection: ", err)
		panic(err)
	}
	runner = connection.Conn
}

func openReplWs(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// queryValues := r.URL.Query()
	// language := queryValues.Get("lang")
	// Start initial container if this is the first connection
	fmt.Println("number of websocket conns: ", len(wsockets))
	if len(wsockets) == 0 {
		// fmt.Sprintf("Starting initial container (%s)\n", language)
		fmt.Println("Starting initial container")
		startContainer("javascript")
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5000", "codeconnected.dev"},
	})
	if err != nil {
		panic(err)
	}
	defer ws.Close(websocket.StatusInternalError, "deferred close")
	wsockets = append(wsockets, ws)

	// Websocket receive loop
	for {
		// Receive command
		mtype, message, err := ws.Read(context.Background())
		fmt.Println("mtype: ", mtype)
		fmt.Println("message: ", message)
		if err != nil {
			fmt.Println("error receiving message: ", err, " ", time.Now().String())
			break
		}

		fmt.Printf("Command received: %s\n", message)
		if string(message) != "KEEPALIVE" {
			executeCommand(message)
		}
	}
}

func startRunnerReader() {
	if runnerReaderActive {
		return
	}
	promptWait := 200 // in ms
	runnerReaderActive = true
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
		fmt.Println("Reading from runner\n")
		var timer *time.Timer
		for {
			ru, _, err := connection.Reader.ReadRune()
			byteSlice := []byte(string(ru))
			fmt.Println("char: ", string(ru))
			fmt.Println("byte slice: ", byteSlice)
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
			fmt.Println("fakeTermBuffer: ", string(fakeTermBuffer))
			fmt.Println("fakeTermBuffer: ", fakeTermBuffer)

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
				writeToWebsockets(byteSlice)
			}
		}
	}()
	fmt.Println("closing runner reader")
	runnerReaderActive = false
}

func writeToWebsockets(byteSlice []byte) {
	var newList []*websocket.Conn
	for _, ws := range wsockets {
		err := ws.Write(context.Background(), websocket.MessageText, byteSlice)
		if err != nil {
			fmt.Println("ws write err: ", "byteSlice", byteSlice, "; err: ", err)
			ws.Close(websocket.StatusInternalError, "deferred close")
			continue
		}
		newList = append(newList, ws)
	}
	wsockets = newList
	fmt.Println("number of active websockets: ", len(wsockets))
}

func executeCommand(command []byte) {
	fmt.Println("Executing command")

	tries := 0
	for tries < 5 {
		// Back off on each failed connection attempt
		time.Sleep(time.Duration(tries/2) * time.Second)
		// FIXME: Why do I make before I assign? Can I just delete
		// the make?
		payload := make([]byte, 1)
		payload = []byte(command)
		_, err := runner.Write([]byte(payload))
		if err == nil {
			fmt.Printf("Payload bytes: %#v\n\n", []byte(payload))
			break
		}
		fmt.Println("runner write error: ", err)
		// Reestablish connection
		fmt.Println("trying to reestablish connection")
		openRunnerConn()
		startRunnerReader()
		tries++
	}

	// If unable to connect
	if tries == 5 {
		panic(errors.New("unable to reconnect to runner"))
	}
}

func saveContent(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Content  string
		Filename string
	}
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

	// Copy contents of user program to container.
	err = cli.CopyToContainer(ctx, containerID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	if err != nil {
		panic(err)
	}

	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Successfully wrote code to container"))
}

func startContainer(lang string) {
	ctx := context.Background()
	cmd := []string{"bash"}
	// var cmd []string
	// switch lang {
	// case ("javascript"):
	// 	cmd = []string{"custom-node-launcher"}
	// case ("ruby"):
	// 	cmd = []string{"pry"}
	// case ("sql"):
	// 	cmd = []string{"psql"}
	// }
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
	containerID = resp.ID
	openRunnerConn()
	startRunnerReader()
}

func switchLanguage(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// fmt.Print("Stopping container ", containerID, "... ")
	// if err := cli.ContainerStop(ctx, containerID, nil); err != nil {
	// 	fmt.Println("Unable to stop container")
	// 	panic(err)
	// }
	// fmt.Println("Successfully stopped container")

	queryValues := r.URL.Query()
	lang := queryValues.Get("lang")

	ctx := context.Background()
	cmd := []string{"screen", "-S", "test", "-X", "select", lang}
	execOpts := types.ExecConfig{
		User:         "codeuser",
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
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
	defer connection.Close()

	output := make([]byte, 0, 512)
	// Get 8-byte header of multiplexed stdout/stderr stream
	// and then read data, and repeat until EOF
	for {
		h := make([]byte, 8)
		_, err := connection.Reader.Read(h)
		if err == io.EOF {
			break
		}
		if err != nil {
			fmt.Println("error in reading header: ", err)
		}

		// First byte indicates stdout or stderr
		// var streamType string
		// if h[0] == 2 {
		// 	streamType = "stderr"
		// } else {
		// 	streamType = "stdout"
		// }

		// Last 4 bytes represent uint32 size
		size := h[4] + h[5] + h[6] + h[7]
		b := make([]byte, size)
		_, err = connection.Reader.Read(b)
		if err == io.EOF {
			break
		}
		if err != nil {
			fmt.Println("error in reading output body: ", err)
		}

		output = append(output, b...)
	}

	fmt.Println("output from direct command: ", output)
}

// TODO: Make sure repl is at prompt before running code
// TODO: Make sure prompt is in correct repl before running code
// (maybe by running a certain command and examining the output)
// TODO: No.2: If repl is not at prompt, get is there (by exiting
// and re-entering?)
func runFile(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	lang := queryValues.Get("lang")
	linesOfCode := queryValues.Get("lines")
	writeToWebsockets([]byte("Running your code...\r\n"))
	echo = false
	// ansiS := map[string]string{
	// 	"saveP":    "\x1B[s",
	// 	"restoreP": "\x1B[u",
	// 	"up1":      "\x1B[1A",
	// 	"down1":    "\x1B[1B",
	// 	"dLine:":   "\x1B[2K",
	// }
	switch lang {
	case "ruby":
		runner.Write([]byte("exec $0\n")) // reset repl
		setEventListener("promptReady", func(config eventConfig) {
			removeEventListener("promptReady")
			runner.Write([]byte("puts 'ST' + 'ART'; " + "load 'code.rb';\n"))
		})
		setEventListener("startOutput", func(config eventConfig) {
			removeEventListener("startOutput")
			echo = true
		})
	case "javascript":
		runner.Write([]byte(".clear\n"))
		setEventListener("promptReady", func(config eventConfig) {
			removeEventListener("promptReady")
			// Delete two previous lines from remote terminal
			runner.Write([]byte(".load code.js\n"))

			// Turn echo back on right before output begins
			// Set this event listener after the promptReady event
			// fires to ensure that only newlines after the prompt are
			// counted
			setEventListener("newline", func(config eventConfig) {
				lines, err := strconv.Atoi(linesOfCode)
				if err != nil {
					fmt.Println("strconv error: ", err)
				}
				if config.count == lines+1 {
					echo = true
					removeEventListener("newline")
				}
			})
		})
	}
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
	defer connection.Close()
	router := httprouter.New()
	router.POST("/api/savecontent", saveContent)
	router.GET("/api/openreplws", openReplWs)
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

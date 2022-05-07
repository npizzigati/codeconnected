package main

import (
	// "bytes"
	"context"
	// "encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/client"
	"github.com/julienschmidt/httprouter"
	"github.com/rs/cors"
	"io"
	"net"
	"net/http"
	"nhooyr.io/websocket"
	"time"
)

// var ws *websocket.Conn

// TODO: Can there variables/constants be passed around in a
// context object instead?
var cli *client.Client
var connection types.HijackedResponse
var runner net.Conn
var ws *websocket.Conn

var containerID = "myshell"
var attachOpts = types.ContainerAttachOptions{
	Stream: true, // This apparently needs to be true for Conn.Write to work
	Stdin:  true,
	Stdout: true,
	Stderr: false,
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
	connection, err = cli.ContainerAttach(context.Background(), containerID, attachOpts)
	if err != nil {
		fmt.Println("error in getting new connection: ", err)
		panic(err)
	}

	runner = connection.Conn
	if err != nil {
		fmt.Println("error in setting deadline: ", err)
	}
}

func serveReplWs(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	fmt.Println("Will try to open ws")

	var err error
	ws, err = websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5000", "codeconnected.dev"},
	})
	if err != nil {
		panic(err)
	}
	defer ws.Close(websocket.StatusInternalError, "deferred close")

	// Set up read listener on runner output
	startRunnerReader()

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
	go func() {
		fmt.Println("Reading from runner\n")
		for {
			chunk := make([]byte, int(1))
			_, err := runner.Read(chunk)
			if err == io.EOF {
				fmt.Println("EOF hit in runner output")
				break
			}
			if err != nil {
				// Runner not connected
				fmt.Println("runner read error: ", err, time.Now().String())
				break
			}

			err = ws.Write(context.Background(), websocket.MessageBinary, chunk)
			if err != nil {
				fmt.Println("ws write err: ", "chunk", chunk, "; err: ", err)
				break
			}
		}
	}()
}

func executeCommand(command []byte) {
	fmt.Println("Executing command")
	// newline := byte(0x0a)
	// payload := append(command, newline)

	for {
		fmt.Println("looping")
		payload := make([]byte, 1)
		// if bytes.Equal(command, []byte("Enter")) {
		// 	fmt.Println("Command is Enter")
		// 	payload[0] = byte(0x0a)
		// } else {
		payload = []byte(command)
		// }
		fmt.Println("payload created")
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

	containerID := "myshell"

	// Copy contents of user program to container.
	err = cli.CopyToContainer(ctx, containerID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	if err != nil {
		panic(err)
	}

	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Successfully wrote code to container"))

	// // Execute user program in container.
	// cmd := []string{"node", "/home/codeuser/program.js"}
	// execOpts := types.ExecConfig{
	// 	AttachStdout: true,
	// 	AttachStderr: true,
	// 	Tty:          true,
	// 	Cmd:          cmd,
	// }

	// resp, err := cli.ContainerExecCreate(ctx, containerID, execOpts)
	// if err != nil {
	// 	panic(err)
	// }

	// connection, err := cli.ContainerExecAttach(context.Background(),
	// 	resp.ID, types.ExecStartCheck{})
	// if err != nil {
	// 	panic(err)
	// }
	// defer connection.Close()

	// // Probably should use StdCopy here:
	// // https://pkg.go.dev/github.com/docker/docker/pkg/stdcopy
	// output := make([]byte, 0, 512)
	// // Get 8-byte header of multiplexed stdout/stderr stream
	// // and then read data, and repeat until EOF
	// for {
	// 	h := make([]byte, 8)
	// 	_, err := connection.Reader.Read(h)
	// 	if err == io.EOF {
	// 		break
	// 	}
	// 	if err != nil {
	// 		panic(err)
	// 	}

	// 	// First byte indicates stdout or stderr
	// 	// var streamType string
	// 	// if h[0] == 2 {
	// 	// 	streamType = "stderr"
	// 	// } else {
	// 	// 	streamType = "stdout"
	// 	// }

	// 	// Last 4 bytes represent uint32 size
	// 	size := h[4] + h[5] + h[6] + h[7]
	// 	b := make([]byte, size)
	// 	_, err = connection.Reader.Read(b)
	// 	if err == io.EOF {
	// 		break
	// 	}
	// 	if err != nil {
	// 		panic(err)
	// 	}

	// 	output = append(output, b...)
	// }

	// fmt.Printf("output: %s", output)
	// w.Header().Set("Content-Type", "application/json")
	// w.WriteHeader(http.StatusCreated)
	// resp2 := map[string]string{
	// 	"output": string(output),
	// }
	// jsonResp, err := json.Marshal(resp2)
	// if err != nil {
	// 	panic(err)
	// }
	// w.Write(jsonResp)
}

func main() {
	initClient()
	openRunnerConn()
	defer connection.Close()
	router := httprouter.New()
	router.POST("/api/savecontent", saveContent)
	router.GET("/api/openreplws", serveReplWs)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("Starting server on port %d\n", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

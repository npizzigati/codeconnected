package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/client"
	"github.com/gorilla/websocket"
	"github.com/julienschmidt/httprouter"
	"github.com/rs/cors"
	"io"
	"net"
	"net/http"
	// "time"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Server is only exposed on internal docker network, so we
		// don't need to protect against XSS
		return true
	},
}

var cli *client.Client

func connectRunner() {
	var err error
	cli, err = client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		panic(err)
	}
}

func serveReplWs(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	ctx := context.Background()
	connectRunner()
	containerID := "myshell"
	attachOpts := types.ContainerAttachOptions{
		Stream: true, // This apparently needs to be true for Conn.Write to work
		Stdin:  true,
		Stdout: true,
		Stderr: false,
	}
	connection, err := cli.ContainerAttach(ctx, containerID, attachOpts)
	if err != nil {
		panic(err)
	}
	runner := connection.Conn
	defer connection.Close()

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		panic(err)
	}
	defer ws.Close()

	// This probably isn't necessary
	// Write initial bytes
	// _, err = runner.Write([]byte("console.log('hello')\n"))
	// if err != nil {
	// 	panic(err)
	// }

	// Set up read listener on runner output
	go func() {
		fmt.Println("Now reading from runner")
		for {
			chunk := make([]byte, int(1))
			_, err := runner.Read(chunk)
			if err == io.EOF {
				fmt.Println("EOF hit in runner output")
				break
			}
			if err != nil {
				// Runner not connected
				fmt.Println(err)
				break
			}
			// Send chunk to browser
			err = ws.WriteMessage(websocket.TextMessage, chunk)
			if err != nil {
				fmt.Println(err)
				break
			}
		}
	}()

	// Websocket receive loop
	for {
		// Receive command
		_, message, err := ws.ReadMessage()
		if err != nil {
			break
		}

		fmt.Printf("Command received: %s\n", message)
		executeCommand(runner, message)
	}
}

func executeCommand(runner net.Conn, command []byte) {
	fmt.Println("Executing command\n")
	newline := byte(0x0a)
	payload := append(command, newline)
	_, err := runner.Write([]byte(payload))
	// TODO: An error here occurs after connection has been idle
	// for a long time (broken pipe), but connection is restored if
	// user sends command again. We should try to make that retry
	// automatic somehow
	if err != nil {
		fmt.Println(err)
		return
	}
	fmt.Printf("Payload bytes: %#v\n", []byte(payload))
}

func executeContent(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Content string
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
	tarBuffer, err := makeTarball([]byte(cm.Content))
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

	// Execute user program in container.
	cmd := []string{"node", "/home/codeuser/program.js"}
	execOpts := types.ExecConfig{
		AttachStdout: true,
		AttachStderr: true,
		Cmd:          cmd,
	}

	resp, err := cli.ContainerExecCreate(ctx, containerID, execOpts)
	if err != nil {
		panic(err)
	}

	connection, err := cli.ContainerExecAttach(context.Background(),
		resp.ID, types.ExecStartCheck{})
	if err != nil {
		panic(err)
	}
	defer connection.Close()

	// Probably should use StdCopy here:
	// https://pkg.go.dev/github.com/docker/docker/pkg/stdcopy
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
			panic(err)
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
			panic(err)
		}

		output = append(output, b...)
	}

	fmt.Printf("output: %s", output)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	resp2 := map[string]string{
		"output": string(output),
	}
	jsonResp, err := json.Marshal(resp2)
	if err != nil {
		panic(err)
	}
	w.Write(jsonResp)
}

func main() {
	router := httprouter.New()
	router.POST("/api/executecontent", executeContent)
	router.GET("/api/openreplws", serveReplWs)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("Starting server on port %d", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

package main

import (
	"context"
	"encoding/json"
	"errors"
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

	tries := 0
	for tries < 5 {
		// Back off on each failed connection attempt
		time.Sleep(time.Duration(tries/2) * time.Second)
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

	containerID := "myshell"

	// Copy contents of user program to container.
	err = cli.CopyToContainer(ctx, containerID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	if err != nil {
		panic(err)
	}

	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Successfully wrote code to container"))
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

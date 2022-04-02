package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/client"
	"github.com/julienschmidt/httprouter"
	"github.com/rs/cors"
	"io"
	"net/http"
)

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

	containerID := "188cecc9354a"

	// Copy contents of user program to container.
	err = cli.CopyToContainer(ctx, containerID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	if err != nil {
		panic(err)
	}

	// Execute user program in container.
	cmd := []string{"node", "program.js"}
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
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("Starting server on port %d", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}

	// address := fmt.Sprintf("0.0.0.0:%d", port)
	// server := http.Server{
	// 	Addr:    address,
	// 	Handler: router,
	// }
	// if err := server.ListenAndServe(); err != nil {
	// 	panic(err)
	// }
}

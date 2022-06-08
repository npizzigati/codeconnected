package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v4/pgxpool"
	// "github.com/aws/aws-sdk-go-v2"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sesTypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/gorilla/sessions"
	// "github.com/jackc/pgx/v4"
	"github.com/julienschmidt/httprouter"
	"github.com/rs/cors"
	"golang.org/x/crypto/bcrypt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"nhooyr.io/websocket"
	"os"
	"regexp"
	"strconv"
	"time"
)

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
	termHist         []byte
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
var store = sessions.NewCookieStore([]byte(os.Getenv("SESS_STORE_SECRET")))
var initialPrompts = map[string][]byte{
	"ruby":       []byte("[1] pry(main)> "),
	"javascript": []byte("Welcome to Node.js.\r\nType \".help\" for more information.\r\n> "),
	"sql":        []byte("psql\r\nType \"help\" for help.\r\ncodeuser=> "),
}
var pool *pgxpool.Pool

var sesCli *sesv2.Client

// const dbURL = "postgres://postgres@db/"

func initDBConnectionPool() {
	config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		// ...
	}
	pool, err = pgxpool.ConnectConfig(context.Background(), config)
}

func initSesClient() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		fmt.Println("error in loading AWS SES config: ", err)
	}
	sesCli = sesv2.NewFromConfig(cfg)
}

func sendPasswordResetEmail(baseURL, resetCode string) {
	resetURL := fmt.Sprintf("%s/reset-password?code=%s", baseURL, resetCode)
	subject := "Reset your password"
	body := fmt.Sprintf("Reset your password by visiting the following link: %s", resetURL)
	fromAddr := "noreply@codeconnected.dev"
	sendEmail(subject, body, fromAddr)
}

func sendVerificationEmail(baseURL, activationCode string) {
	activationURL := fmt.Sprintf("%s/activate?code=%s", baseURL, activationCode)
	subject := "Verify your email address"
	body := fmt.Sprintf("Verify your email address by visiting the following URL: %s", activationURL)
	fromAddr := "noreply@codeconnected.dev"
	sendEmail(subject, body, fromAddr)
}

func sendEmail(subject, body, fromAddr string) {
	destAddr := sesTypes.Destination{
		ToAddresses: []string{"npizzigati@gmail.com"},
	}
	simpleMessage := sesTypes.Message{
		Subject: &sesTypes.Content{
			Data: &subject,
		},
		Body: &sesTypes.Body{
			Text: &sesTypes.Content{
				Data: &body,
			},
		},
	}
	emailContent := sesTypes.EmailContent{
		Simple: &simpleMessage,
	}
	email := sesv2.SendEmailInput{
		Destination:      &destAddr,
		FromEmailAddress: &fromAddr,
		Content:          &emailContent,
	}
	output, err := sesCli.SendEmail(context.Background(), &email)
	if err != nil {
		fmt.Println("Error in sending email: ", err)
		return
	}
	fmt.Println("sendEmail output: ", output)
}

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

func getLangAndHist(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	lang := rooms[roomID].lang
	hist := rooms[roomID].termHist

	type responseModel struct {
		Language string `json:"language"`
		History  string `json:"history"`
	}
	response := &responseModel{
		Language: lang,
		History:  string(hist),
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func createRoom(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type roomModel struct {
		Language string
	}
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

	// If first websocket in room, display initial repl message/prompt
	if len(rooms[roomID].wsockets) == 1 {
		displayInitialPrompt(roomID)
	}

	// Websocket receive loop
	for {
		// Receive command
		_, message, err := ws.Read(context.Background())
		fmt.Println("message: ", message)
		if err != nil {
			fmt.Println("error receiving message: ", err, " ", time.Now().String())
			// TODO: -- I should try to recover after this (reopen ws?)
			break
		}

		fmt.Printf("Command received: %s\n", message)
		stringMessage := string(message)
		if stringMessage == "KEEPALIVE" {
			continue
		}
		sendToContainer(message, roomID)
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
func writeToWebsockets(text []byte, roomID string) {
	fmt.Println("writing to wsockets: ", text, string(text))
	fmt.Println("number of wsocket conns: ", len(rooms[roomID].wsockets))
	room := rooms[roomID]
	var newList []*websocket.Conn
	// Also write to history if at least one client connected
	if len(room.wsockets) > 0 {
		// Don't write special reset message to history
		if string(text) != "RESETTERMINAL" {
			room.termHist = append(room.termHist, text...)
		}
	}

	for _, ws := range room.wsockets {
		fmt.Println("********Writing to websocket*********")
		err := ws.Write(context.Background(), websocket.MessageText, text)
		// If websocket is no longer available, leave it out of new list
		if err != nil {
			fmt.Println("ws write err: ", "text", text, "; err: ", err)
			ws.Close(websocket.StatusInternalError, "websocket no longer available")
			continue
		}
		newList = append(newList, ws)
	}
	room.wsockets = newList
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
	type contentModel struct {
		Content  string
		Filename string
		RoomID   string
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
	room.echo = false
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
			room.echo = true
			displayInitialPrompt(roomID)
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

func displayInitialPrompt(roomID string) {
	lang := rooms[roomID].lang
	var message []byte
	switch lang {
	case "ruby":
		message = initialPrompts["ruby"]
	case "javascript":
		message = initialPrompts["javascript"]
	case "sql":
		message = initialPrompts["sql"]
	}
	resetTerminal(roomID)
	writeToWebsockets(message, roomID)
}

// TODO: make this a room method
func resetTerminal(roomID string) {
	writeToWebsockets([]byte("RESETTERMINAL"), roomID)
	// Also reset terminal history
	rooms[roomID].termHist = []byte("")
}

func clientClearTerm(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		LastLine string `json:"lastLine"`
		RoomID   string `json:"roomID"`
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

	rooms[cm.RoomID].termHist = []byte(cm.LastLine)

	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte("Successfully cleared history"))
}

func signIn(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type contentModel struct {
		Email       string `json:"email"`
		PlainTextPW string `json:"plainTextPW"`
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
	fmt.Println("credentials: ", cm.Email, cm.PlainTextPW)
	pepperedPW := cm.PlainTextPW + os.Getenv("PWPEPPER")

	emailFound := true
	signedIn := false
	var encryptedPW string
	query := "SELECT encrypted_pw FROM users WHERE email = $1"
	if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&encryptedPW); err != nil {
		// Will throw error if no records found
		emailFound = false
		fmt.Println("select query error: ", err)
	}

	if emailFound && bcrypt.CompareHashAndPassword([]byte(encryptedPW), []byte(pepperedPW)) == nil {
		// success
		fmt.Println("*****Successfully signed in")
		signedIn = true
		session.Values["auth"] = true
		session.Values["email"] = cm.Email
		if err = session.Save(r, w); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		fmt.Println("*****Sign in was unsuccessful.")
	}

	type responseModel struct {
		SignedIn bool `json:"signedIn"`
	}
	response := &responseModel{
		SignedIn: signedIn,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func checkAuth(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	fmt.Println("checking auth on server")
	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type responseModel struct {
		Auth     bool   `json:"auth"`
		UserName string `json:"userName"`
		Email    string `json:"email"`
	}

	if auth, ok := session.Values["auth"].(bool); !ok || !auth {
		response := &responseModel{
			Auth: false,
		}
		fmt.Println("user not authorized")
		jsonResp, err := json.Marshal(response)
		if err != nil {
			fmt.Println("err in marshaling: ", err)
			return
		}
		w.Header().Set("Content-Type", "application/json;charset=UTF-8")
		w.WriteHeader(http.StatusOK)
		w.Write(jsonResp)
		return
	}

	var (
		email, username string
		ok              bool
	)
	if email, ok = session.Values["email"].(string); !ok {
		fmt.Println("Email not found")
	}

	// Get username
	// TODO: Extract this to a method
	query := "SELECT username FROM users WHERE email = $1"
	if err := pool.QueryRow(context.Background(), query, email).Scan(&username); err != nil {
		fmt.Println("username select query error: ", err)
	}

	fmt.Printf("Server: User logged in as %s, with email: %s", username, email)

	session.Values["username"] = username

	response := &responseModel{
		Auth:     true,
		Email:    email,
		UserName: username,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}

	err = session.Save(r, w)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func forgotPassword(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Email   string `json:"email"`
		BaseURL string `json:"baseURL`
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
	// Determine whether email is in database
	query := "SELECT id FROM users WHERE email = $1"
	emailFound := true
	var userID int
	if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&userID); err != nil {
		fmt.Println("query error: ", err)
		emailFound = false
	}

	if !emailFound {
		// TODO: Change other json structs into maps
		failureResp, err := json.Marshal(
			map[string]string{
				"status": "failure",
			})
		if err != nil {
			fmt.Println("err in marshaling: ", err)
		}
		sendJsonResponse(w, failureResp)
		return
	}

	fmt.Println("Email was found")

	expiry := time.Now().Add(5 * time.Minute).Unix()
	code := generateRandomCode()
	// Enter code and expiry into password reset requests
	query = "INSERT INTO password_reset_requests(user_id, reset_code, expiry) VALUES($1, $2, $3)"
	if _, err := pool.Exec(context.Background(), query, userID, code, expiry); err != nil {
		fmt.Println("unable to insert password reset request in db: ", err)
	}
	sendPasswordResetEmail(cm.BaseURL, code)

	successResp, err := json.Marshal(
		map[string]string{
			"status": "success",
		})
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}
	sendJsonResponse(w, successResp)
}

func generateRandomCode() string {
	rand.Seed(time.Now().UnixNano())
	return strconv.Itoa(rand.Int())
}

// TODO: Use this where appropriate
func sendStringJsonResponse(w http.ResponseWriter, data map[string]string) {
	resp, err := json.Marshal(data)
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}
	sendJsonResponse(w, resp)
	return
}

// TODO: Use this helper function when appropriate
func sendJsonResponse(w http.ResponseWriter, jsonResp []byte) {
	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func resetPassword(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Email          string `json:"email"`
		Code           string `json:"code"`
		NewPlaintextPW string `json:"newPlaintextPW"`
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
	fmt.Println("reset code received: ", cm.Code)

	// Find reset code in db
	query := "SELECT p.user_id, p.expiry FROM password_reset_requests AS p INNER JOIN users AS u ON p.user_id = u.id WHERE p.reset_code = $1 AND u.email = $2"
	var userID int
	var expiry int64
	var status, reason string
	if err := pool.QueryRow(context.Background(), query, cm.Code, cm.Email).Scan(&userID, &expiry); err != nil {
		fmt.Println("Error in finding user (reset password): ", err)
		status = "failure"
		reason = "row not found or other database error"
	}

	fmt.Println("now: ", time.Now().Unix())
	fmt.Println("expiry: ", expiry)
	// If row was not found, expiry will be 0
	if expiry != 0 && time.Now().Unix() > expiry {
		status = "failure"
		reason = "code expired"
		// delete expired record
		deleteRequestRec(cm.Code)
	}

	if status == "failure" {
		sendStringJsonResponse(w, map[string]string{"status": "failure", "reason": reason})
		return
	}

	fmt.Println("Reset password code and user found")

	// Generate encrypted password
	pepperedPW := cm.NewPlaintextPW + os.Getenv("PWPEPPER")
	encryptedPW, err := bcrypt.GenerateFromPassword([]byte(pepperedPW),
		bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}

	// Change password in db
	query = "UPDATE users SET encrypted_pw = $1 WHERE id = $2"
	if _, err := pool.Exec(context.Background(), query, encryptedPW, userID); err != nil {
		fmt.Println("unable to insert: ", err)
		sendStringJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	// Delete completed reset request from database
	deleteRequestRec(cm.Code)
	sendStringJsonResponse(w, map[string]string{"status": "success"})
}

func deleteRequestRec(code string) {
	query := "DELETE FROM password_reset_requests WHERE reset_code = $1"
	if _, err := pool.Exec(context.Background(), query, code); err != nil {
		fmt.Println("unable to delete request record: ", err)
	}
}

func activateUser(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := store.Get(r, "session")
	type contentModel struct {
		Code string `json:"code"`
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
	fmt.Println("activation code received: ", cm.Code)
	// Move user from pending activations to user if code is found
	query := "SELECT username, email, encrypted_pw FROM pending_activations WHERE activation_code = $1"
	var username, email, encryptedPW string
	recordFound := true
	status := "success"
	if err = pool.QueryRow(context.Background(), query, cm.Code).Scan(&username, &email, &encryptedPW); err != nil {
		fmt.Println("query error: ", err)
		recordFound = false
		status = "failure"
	}

	type responseModel struct {
		Status string `json:"status"`
	}
	if recordFound {
		query := "DELETE FROM pending_activations WHERE activation_code=$1"
		if _, err := pool.Exec(context.Background(), query, cm.Code); err != nil {
			fmt.Println("unable to delete activation record: ", err)
			status = "failure"
		}
		query = "INSERT INTO users(username, email, encrypted_pw) VALUES($1, $2, $3)"
		if _, err := pool.Exec(context.Background(), query, username, email, encryptedPW); err != nil {
			fmt.Println("unable to insert user data: ", err)
			status = "failure"
		}
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	session.Values["auth"] = true
	session.Values["email"] = email
	if err = session.Save(r, w); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := &responseModel{
		Status: status,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func signUp(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		BaseURL     string `json:"baseURL"`
		Username    string `json:"username"`
		Email       string `json:"email"`
		PlainTextPW string `json:"plainTextPW"`
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
	fmt.Println("credentials: ", cm.Username, cm.Email, cm.PlainTextPW)
	fmt.Println("baseURL: ", cm.BaseURL)
	pepperedPW := cm.PlainTextPW + os.Getenv("PWPEPPER")
	encryptedPW, err := bcrypt.GenerateFromPassword([]byte(pepperedPW),
		bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}

	code := generateRandomCode()

	// Check whether user has already registered
	var emailUsed bool
	query := "SELECT 1 FROM users WHERE email = $1"
	var tmp int
	if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&tmp); err == nil {
		// Will throw error if no records found
		fmt.Printf("email %s already registered", cm.Email)
		emailUsed = true
	} else {
		query = "SELECT 1 FROM pending_activations WHERE email = $1"
		var tmp int
		if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&tmp); err == nil {
			// Will throw error if no records found
			fmt.Printf("email %s is pending activation", cm.Email)
			emailUsed = true
		}
	}

	if !emailUsed {
		query = "INSERT INTO pending_activations(username, email, encrypted_pw, activation_code) VALUES($1, $2, $3, $4)"
		if _, err := pool.Exec(context.Background(), query, cm.Username, cm.Email, encryptedPW, code); err != nil {
			fmt.Println("unable to insert: ", err)
		}

		sendVerificationEmail(cm.BaseURL, code)
	}

	type responseModel struct {
		EmailUsed bool `json:"emailUsed"`
	}
	response := &responseModel{
		EmailUsed: emailUsed,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		fmt.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
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
	initSesClient()
	initDBConnectionPool()
	store.Options = &sessions.Options{
		SameSite: http.SameSiteStrictMode,
	}
	router := httprouter.New()
	router.POST("/api/savecontent", saveContent)
	// FIXME: Should this be a POST (is it really idempotent)?
	router.GET("/api/openws", openWs)
	router.POST("/api/createroom", createRoom)
	router.POST("/api/activateuser", activateUser)
	router.GET("/api/getlangandhist", getLangAndHist)
	router.GET("/api/check-auth", checkAuth)
	router.POST("/api/switchlanguage", switchLanguage)
	router.POST("/api/runfile", runFile)
	router.POST("/api/sign-up", signUp)
	router.POST("/api/sign-in", signIn)
	router.POST("/api/forgot-password", forgotPassword)
	router.POST("/api/reset-password", resetPassword)
	router.POST("/api/clientclearterm", clientClearTerm)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	fmt.Printf("Starting server on port %d\n", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

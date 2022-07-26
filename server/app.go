package main

// TODO: General: 1. Limit processor time for each container
//                2. Remove networking
//                3. Have containers timeout after certain period
//                   of inactivity

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v4/pgxpool"
	"log"
	"strings"
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
	ID                  string
	execID              string
	connection          types.HijackedResponse
	runner              net.Conn
	bufReader           *bufio.Reader
	runnerReaderActive  bool
	runnerReaderRestart bool
}

type eventConfig struct {
	count int
}

type room struct {
	wsockets         []*websocket.Conn
	creatorUserID    int
	lang             string
	codeSessionID    int
	initialContent   string
	echo             bool
	container        *containerDetails
	eventSubscribers map[string]func(eventConfig)
	termHist         []byte
	status           string
	expiry           int64
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
	"ruby":     []byte("[1] pry(main)> "),
	"node":     []byte("Welcome to Node.js.\r\nType \".help\" for more information.\r\n> "),
	"postgres": []byte("psql\r\nType \"help\" for help.\r\ncodeuser=> "),
}
var pool *pgxpool.Pool
var sesCli *sesv2.Client

// Timeouts in minutes
const activationTimeout = 5
const anonRoomTimeout = 15

// Logger
var logger = log.New(os.Stderr, "LOG: ", log.Ldate|log.Ltime|log.Lshortfile)

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
		logger.Println("error in loading AWS SES config: ", err)
	}
	sesCli = sesv2.NewFromConfig(cfg)
}

func sendPasswordResetEmail(resetCode string) {
	subject := "Reset your password"
	body := fmt.Sprintf("Your password reset code is: %s", resetCode)
	fromAddr := "noreply@codeconnected.dev"
	sendEmail(subject, body, fromAddr)
}

func sendVerificationEmail(activationCode string) {
	subject := "Verify email address"
	body := fmt.Sprintf("Your activation code is: %s", activationCode)
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
		logger.Println("Error in sending email: ", err)
		return
	}
	logger.Println("sendEmail output: ", output)
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

func getInitialRoomData(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	lang := rooms[roomID].lang
	hist := rooms[roomID].termHist
	expiry := rooms[roomID].expiry

	type responseModel struct {
		Language  string `json:"language"`
		History   string `json:"history"`
		Expiry    int64  `json:"expiry"`
		IsCreator bool   `json:"isCreator"`
	}

	// Get userID from session. If user isn't signed in userID will
	// be -1
	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var userID int
	var ok bool
	if userID, ok = session.Values["userID"].(int); !ok {
		logger.Println("userID not found")
		userID = -1
	}

	isCreator := false
	if userID != -1 && userID == rooms[roomID].creatorUserID {
		isCreator = true
	}

	response := &responseModel{
		Language:  lang,
		History:   string(hist),
		Expiry:    expiry,
		IsCreator: isCreator,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func getCodeSessions(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var userID int
	var ok bool
	if userID, ok = session.Values["userID"].(int); !ok {
		logger.Println("userID not found")
		userID = -1
	}

	type codeSession struct {
		SessID        int    `json:"sessID"`
		Lang          string `json:"lang"`
		Content       string `json:"content"`
		When_accessed int64  `json:"when_accessed"`
	}

	type responseModel struct {
		CodeSessions []codeSession `json:"codeSessions"`
	}

	var cSession codeSession
	var cSessions []codeSession
	var id int32
	var lang string
	var content string
	var when_accessed int64
	queryLines :=
		[]string{"SELECT id, lang, editor_contents, when_accessed",
			"FROM coding_sessions WHERE user_id = $1",
			"ORDER BY when_accessed DESC LIMIT 5"}
	query := strings.Join(queryLines, " ")
	rows, err := pool.Query(context.Background(), query, userID)
	if err != nil {
		logger.Println("Query unsuccessful: ", err)
	}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			logger.Println("Error iterating dataset: ", err)
		}
		// Database gives int value as int32
		if id, ok = values[0].(int32); !ok {
			logger.Println("Type assertion failed")
		}
		if lang, ok = values[1].(string); !ok {
			logger.Println("Type assertion failed")
		}
		// If editor_contents is nil, set content to ""
		// (if we don't do this, the type assertion below will fail)
		if values[2] == nil {
			content = ""
		} else if content, ok = values[2].(string); !ok {
			logger.Println("Type assertion failed")
		}
		if when_accessed, ok = values[3].(int64); !ok {
			logger.Println("Type assertion failed")
		}
		cSession = codeSession{
			SessID:        int(id),
			Lang:          lang,
			Content:       content,
			When_accessed: when_accessed,
		}
		cSessions = append(cSessions, cSession)
	}
	response := &responseModel{
		CodeSessions: cSessions,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func saveCodeSession(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type codeSessionModel struct {
		CodeSessionID int
		Content       string
	}
	var csm codeSessionModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
		sendStringJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &csm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
		sendStringJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	logger.Println("content: ", csm.Content)
	logger.Println("codeSessionID: ", csm.CodeSessionID)

	query := "UPDATE coding_sessions SET editor_contents = $1 WHERE id = $2"
	if _, err := pool.Exec(context.Background(), query, csm.Content, csm.CodeSessionID); err != nil {
		logger.Println("unable to update content in coding_sessions: ", err)
		sendStringJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	sendStringJsonResponse(w, map[string]string{"status": "success"})
}

func createRoom(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type roomModel struct {
		Language       string `json="language"`
		CodeSessionID  int    `json="codeSessionID"`
		InitialContent string `json="initialContent"`
	}
	var rm roomModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
	}
	err = json.Unmarshal(body, &rm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
	}

	logger.Println("*************rm.Language: ", rm.Language)
	logger.Println("*************rm.CodeSessionID: ", rm.CodeSessionID)

	// If this is an existing code session and the room still
	// exists (is still open), send back that same room ID
	var roomID string
	for k, r := range rooms {
		if r.codeSessionID == rm.CodeSessionID {
			roomID = k
			sendStringJsonResponse(w, map[string]string{"roomID": roomID})
			return
		}
	}

	roomID = generateRoomID()
	logger.Println("************roomID: ", roomID)

	room := room{
		lang:           rm.Language,
		codeSessionID:  rm.CodeSessionID,
		initialContent: rm.InitialContent,
		container:      &containerDetails{},
		status:         "created",
	}

	rooms[roomID] = &room

	sendStringJsonResponse(w, map[string]string{"roomID": roomID})
}

func getRoomStatus(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")

	status := rooms[roomID].status
	resp, err := json.Marshal(
		map[string]string{
			"status": status,
		})
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}
	sendJsonResponse(w, resp)
}

func prepareRoom(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type roomModel struct {
		RoomID string
	}
	var rm roomModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
	}
	err = json.Unmarshal(body, &rm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
	}

	roomID := rm.RoomID
	room := rooms[roomID]

	// Room can only be prepared once. If the link is shared before
	// room is prepared, this request could be made by a second
	// user. Guard against that.
	if room.status == "preparing" {
		sendStringJsonResponse(w, map[string]string{"status": room.status})
		return
	}

	room.status = "preparing"

	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Println("*************rm.RoomID: ", rm.RoomID)

	startContainer(room.lang, roomID)

	var auth, ok bool
	var expiry int64
	if auth, ok = session.Values["auth"].(bool); !ok || !auth {
		logger.Println("Unauthed user")
		expiry = time.Now().Add(anonRoomTimeout * time.Minute).Unix()
	} else {
		expiry = -1
	}
	room.expiry = expiry

	if expiry != -1 {
		// Close room when it expires
		ticker := time.NewTicker(1 * time.Second)
		go func() {
			for {
				select {
				case <-ticker.C:
					currentTime := time.Now().Unix()
					if currentTime >= expiry {
						ticker.Stop()
						logger.Println("!!!!!Room Expired!!!!")
						closeContainerConnection(room.container.connection)
						err := stopAndRemoveContainer(room.container.ID)
						if err != nil {
							logger.Println("error in stopping/removing container: ", err)
						}
						delete(rooms, roomID)
						return
					}
				}
			}
		}()
	}

	var userID int
	if userID, ok = session.Values["userID"].(int); !ok {
		logger.Println("userID not found")
		userID = -1
	}

	room.creatorUserID = userID

	// If this is an existing code session, don't create a new
	// one. Instead update when_accessed timestamp.
	if room.codeSessionID != -1 {
		updateRoomAccessTime(room.codeSessionID)
	} else {
		// If user found, insert code sessions record and get code
		// session ID back
		if userID != -1 {
			currentTime := time.Now().Unix()
			query := "INSERT INTO coding_sessions(user_id, lang, when_created, when_accessed) VALUES($1, $2, $3, $4) RETURNING id"
			if err := pool.QueryRow(context.Background(), query, userID, room.lang, currentTime, currentTime).Scan(&room.codeSessionID); err != nil {
				logger.Println("unable to insert record into coding_sessions: ", err)
			}
		}
	}

	room.status = "ready"

	type responseModel struct {
		Status         string `json:"status"`
		CodeSessionID  int    `json:"codeSessionID"`
		InitialContent string `json:"initialContent"`
	}

	response := &responseModel{
		Status:         "ready",
		CodeSessionID:  room.codeSessionID,
		InitialContent: room.initialContent,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

// Ping/pong to detect when people leave room (websockets stop
// responding client-side). This also takes care of the need to
// ping websockets with a non-empty payload at least once every
// 60 seconds, to prevent nginx proxypass from timing out.
func heartbeat(ctx context.Context, ws *websocket.Conn, d time.Duration, room *room) {
	t := time.NewTimer(d)
	defer t.Stop()
	for {
		select {
		case <-t.C:
		}
		// the Ping method sends a ping and returns on receipt of the
		// corresponding pong or cancelation of the context. If the error
		// returned from Ping is nil, then the pong was received.
		err := ws.Ping(ctx)
		if err != nil {
			ws.Close(websocket.StatusInternalError, "websocket no longer available")
			logger.Println("---------------------Pong NOT received---------------------")
			// TODO: Retry ping after a few seconds to account for the
			// case where a client temporary disconnects (or refreshes
			// the page) at exact instance of ping
			// Remove websocket from room
			var deadIdx int
			for idx, socket := range room.wsockets {
				if socket == ws {
					deadIdx = idx
				}
			}
			room.wsockets = append(room.wsockets[:deadIdx], room.wsockets[deadIdx+1:]...)
			closeEmptyRooms()
			return
		}
		logger.Println("---------------------Pong received---------------------")
		t.Reset(d)
	}
}

func openWs(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	const heartbeatTime = 30
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	room := rooms[roomID]

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5000", "codeconnected.dev"},
	})
	if err != nil {
		logger.Println("error in opening websocket: ", err)
	}
	defer ws.Close(websocket.StatusInternalError, "deferred close")

	// Append websocket to room socket list
	room.wsockets = append(rooms[roomID].wsockets, ws)

	// If first websocket in room, display initial repl message/prompt
	if len(room.wsockets) == 1 {
		displayInitialPrompt(roomID)
	}

	go heartbeat(context.Background(), ws, heartbeatTime*time.Second, room)

	// Websocket receive loop
	for {
		// Receive command
		_, message, err := ws.Read(context.Background())
		logger.Println("message: ", message)
		if err != nil {
			logger.Println("error receiving message: ", err, " ", time.Now().String())
			// TODO: -- I should try to recover after this (reopen
			// ws?). I don't think so
			break
		}

		logger.Printf("Command received: %s\n", message)
		sendToContainer(message, roomID)
	}
}

func startRunnerReader(roomID string) {
	logger.Println("Starting runner reader")
	room := rooms[roomID]
	cn := room.container
	// There should only be one runner reader per container
	if cn.runnerReaderActive {
		logger.Println("Runner reader already active")
		return
	}
	cn.runnerReaderActive = true
	cn.runnerReaderRestart = true
	// Wait time before checking whether prompt is ready, in ms
	promptWait := 200
	fakeTermBuffer := []byte{}
	// number of newlines (\n) after a prompt
	newlineCount := 0
	ansiEscapes, err := regexp.Compile("\x1B(?:[@-Z\\-_]|[[0-?]*[ -/]*[@-~])")
	if err != nil {
		logger.Println("Regexp compilation error: ", err)
	}
	promptTermination, err := regexp.Compile("> $")
	if err != nil {
		logger.Println("Regexp compilation error: ", err)
	}
	go func() {
		logger.Println("Reading from connection\n")
		var timer *time.Timer
		for {
			// Check for 8-byte docker multiplexing header and discard
			// if present
			peek, err := cn.bufReader.Peek(1)
			// Peek will fail if reader is EOF (err == EOF)
			if err != nil {
				logger.Println("peek error: ", err)
				break
			}
			// Header will begin with ascii value 1
			if peek[0] == 1 {
				// Discard the header
				num, err := cn.bufReader.Discard(8)
				if err != nil {
					logger.Println("error in discarding header: ", err)
				}
				logger.Println("header bytes discarded: ", num)
			}

			ru, _, err := cn.bufReader.ReadRune()
			byteSlice := []byte(string(ru))
			if err == io.EOF {
				logger.Println("EOF hit in runner output")
				break
			}
			if err != nil {
				// Runner not connected
				logger.Println("runner read error: ", err, time.Now().String())
				break
			}

			if string(ru) == "\n" {
				logger.Println("*********newline in output*********")
				newlineCount++
				room.emit("newline", eventConfig{count: newlineCount})
				logger.Println("newlineCount: ", newlineCount)
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
						logger.Println("Matched prompt termination")
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
		logger.Println("runner reader loop ended")
		cn.runnerReaderActive = false
		// Try to reestablish connection if anybody is in room
		// and restart flag is true
		if len(room.wsockets) > 0 && room.container.runnerReaderRestart == true {
			logger.Println("Trying to reestablish connection")
			cn.connection.Close()
			openLanguageConnection(room.lang, roomID)
		}
	}()
}

func writeToWebsockets(text []byte, roomID string) {
	logger.Println("writing to wsockets: ", text, string(text))
	room := rooms[roomID]
	// Also write to history if at least one client connected
	if len(room.wsockets) > 0 {
		// Don't write special messages to history
		if string(text) != "RESETTERMINAL" {
			room.termHist = append(room.termHist, text...)
		}
	}

	for _, ws := range room.wsockets {
		logger.Println("********Writing to websocket*********")
		err := ws.Write(context.Background(), websocket.MessageText, text)
		if err != nil {
			logger.Println("ws write err: ", "text", text, "; err: ", err)
		}
	}
	logger.Println("number of wsocket conns: ", len(room.wsockets))
}

func sendToContainer(message []byte, roomID string) {
	logger.Println("Sending message to container")
	cn := rooms[roomID].container
	lang := rooms[roomID].lang

	tries := 0
	// TODO: Is this retry logic duplicated in the attemptLangConn
	// or does it do something else?
	for tries < 5 {
		// Back off on each failed connection attempt
		time.Sleep(time.Duration(tries/2) * time.Second)
		_, err := cn.runner.Write(message)
		if err == nil {
			logger.Printf("Payload bytes: %#v\n\n", message)
			break
		}
		logger.Println("runner write error: ", err)
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
		logger.Println("trying to reestablish connection")
		// TODO: Do I have to find out the status of connection and
		// (if active) close it before opening it again?
		cn.runnerReaderRestart = false
		cn.connection.Close()
		err = openLanguageConnection(lang, roomID)
		if err != nil {
			logger.Println(err)
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
		// The image needs to already be created on the runner server
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
	logger.Println("Setting new container id to: ", resp.ID)
	cn.ID = resp.ID
	// Sql container needs a slight pause to create user
	// This will give openLanguageConnection a better chance of
	// correctly opening the connection on the first try
	if lang == "postgres" {
		time.Sleep(2 * time.Second)
	}
	err = openLanguageConnection(lang, roomID)
	if err != nil {
		logger.Println(err)
	}
}

func resizeTTY(cn *containerDetails, rows int, cols int) error {
	ctx := context.Background()
	resizeOpts := types.ResizeOptions{
		Height: uint(rows),
		Width:  uint(cols),
	}

	err := cli.ContainerExecResize(ctx, cn.execID, resizeOpts)
	return err
}

func switchLanguage(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	lang := queryValues.Get("lang")
	roomID := queryValues.Get("roomID")

	room := rooms[roomID]
	cn := room.container
	room.lang = lang
	logger.Println("Switching language")
	// Set the restart flag to false so that the reader doesn't
	// automatically restart when we close the connection
	cn.runnerReaderRestart = false
	// Connection must be closed here to switch language
	cn.connection.Close()
	err := openLanguageConnection(lang, roomID)
	if err != nil {
		logger.Println(err)
	}

	w.Header().Set("Content-Type", "text/plain;charset=UTF-8")
	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Success"))
}

// FIXME: When this fails, is currently eventually goes to the
// regular codearea user screen. It should give user a modal
// message instead.
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
		logger.Println("Attempting language connection")
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

func closeContainerConnection(connection types.HijackedResponse) {
	// Close connection if it exists
	// (If it doesn't exist, reader ptr will be nil)
	if connection.Reader != nil {
		logger.Println("closing existing connection")
		connection.Close()
	}
}

func attemptLangConn(lang, roomID string) {
	logger.Println("Attempting lang connection, lang: '", lang, "' ", "roomID: '", roomID, "'")
	room := rooms[roomID]
	cn := room.container
	var cmd []string
	switch lang {
	case "node":
		cmd = []string{"custom-node-launcher"}
	case "ruby":
		cmd = []string{"pry"}
	case "postgres":
		cmd = []string{"psql"}
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
		logger.Println("unable to create exec process: ", err)
		return
	}

	cn.connection, err = cli.ContainerExecAttach(ctx,
		resp.ID, types.ExecStartCheck{})
	if err != nil {
		logger.Println("unable to start/attach to exec process: ", err)
		return
	}

	cn.execID = resp.ID
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
	case "node":
		message = initialPrompts["node"]
	case "postgres":
		message = initialPrompts["postgres"]
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

func signOut(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// Delete cookie by sending an immediately expiring cookie with
	// the same name
	cookie := &http.Cookie{
		Name:   "session",
		Value:  "",
		Path:   "/api",
		MaxAge: -1,
	}
	http.SetCookie(w, cookie)

	sendStringJsonResponse(w, map[string]string{"status": "success"})
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
	logger.Println("credentials: ", cm.Email, cm.PlainTextPW)
	pepperedPW := cm.PlainTextPW + os.Getenv("PWPEPPER")

	emailFound := true
	signedIn := false
	var encryptedPW, username string
	var userID int
	query := "SELECT encrypted_pw, username, id FROM users WHERE email = $1"
	if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&encryptedPW, &username, &userID); err != nil {
		// Will throw error if no records found
		emailFound = false
		logger.Println("select query error: ", err)
	}

	if emailFound && bcrypt.CompareHashAndPassword([]byte(encryptedPW), []byte(pepperedPW)) == nil {
		// success
		logger.Println("*****Successfully signed in")
		signedIn = true
		session.Values["auth"] = true
		session.Values["email"] = cm.Email
		session.Values["username"] = username
		session.Values["userID"] = userID
		if err = session.Save(r, w); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		logger.Println("*****Sign in was unsuccessful.")
	}

	type responseModel struct {
		SignedIn bool `json:"signedIn"`
	}
	response := &responseModel{
		SignedIn: signedIn,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func getUserInfo(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type responseModel struct {
		Auth     bool   `json:"auth"`
		Username string `json:"username"`
		Email    string `json:"email"`
	}

	if auth, ok := session.Values["auth"].(bool); !ok || !auth {
		response := &responseModel{
			Auth: false,
		}
		logger.Println("user not authorized")
		jsonResp, err := json.Marshal(response)
		if err != nil {
			logger.Println("err in marshaling: ", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
		logger.Println("Email not found")
	}
	if username, ok = session.Values["username"].(string); !ok {
		logger.Println("Username not found")
	}

	logger.Println("username and email: ", username, email)

	response := &responseModel{
		Auth:     true,
		Email:    email,
		Username: username,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
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
	// Reset timeout in minutes
	const resetTimeout = 10
	type contentModel struct {
		Email string `json:"email"`
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
		logger.Println("query error: ", err)
		emailFound = false
	}

	if !emailFound {
		// TODO: Change other json structs into maps
		failureResp, err := json.Marshal(
			map[string]string{
				"status": "failure",
			})
		if err != nil {
			logger.Println("err in marshaling: ", err)
		}
		sendJsonResponse(w, failureResp)
		return
	}

	logger.Println("Email was found")

	// Delete any existing password reset requests for user
	deleteRequestRec(userID)

	// Enter code and expiry into password reset requests
	expiry := time.Now().Add(resetTimeout * time.Minute).Unix()
	code := generateRandomCode()
	query = "INSERT INTO password_reset_requests(user_id, reset_code, expiry) VALUES($1, $2, $3)"
	if _, err := pool.Exec(context.Background(), query, userID, code, expiry); err != nil {
		logger.Println("unable to insert password reset request in db: ", err)
	}

	// Automatically delete reset request after timeout
	go func() {
		for {
			time.Sleep(1 * time.Minute)
			if time.Now().Unix() > expiry {
				deleteRequestRec(userID)
				break
			}
		}
	}()

	sendPasswordResetEmail(code)

	successResp, err := json.Marshal(
		map[string]string{
			"status": "success",
		})
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}
	sendJsonResponse(w, successResp)
}

func generateRandomCode() string {
	max := 999999
	min := 100000
	rand.Seed(time.Now().UnixNano())
	return strconv.Itoa(rand.Intn(max-min) + min)
}

// TODO: Use this where appropriate
func sendStringJsonResponse(w http.ResponseWriter, data map[string]string) {
	resp, err := json.Marshal(data)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}
	sendJsonResponse(w, resp)
	return
}

func sendBoolJsonResponse(w http.ResponseWriter, data map[string]bool) {
	resp, err := json.Marshal(data)
	if err != nil {
		logger.Println("err in marshaling: ", err)
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
	logger.Println("reset code received: ", cm.Code)
	logger.Println("reset email received: '", cm.Email, "'")

	// Find reset code in db
	query := "SELECT p.user_id, p.expiry FROM password_reset_requests AS p INNER JOIN users AS u ON p.user_id = u.id WHERE p.reset_code = $1 AND u.email = $2"
	var userID int
	var expiry int64
	var status, reason string
	if err := pool.QueryRow(context.Background(), query, cm.Code, cm.Email).Scan(&userID, &expiry); err != nil {
		logger.Println("Error in finding user (reset password): ", err)
		status = "failure"
		reason = "row not found or other database error"
	}

	logger.Println("now: ", time.Now().Unix())
	logger.Println("expiry: ", expiry)
	// If row was not found, expiry will be 0
	if expiry != 0 && time.Now().Unix() > expiry {
		status = "failure"
		reason = "code expired"
		// delete expired record
		deleteRequestRec(userID)
	}

	if status == "failure" {
		sendStringJsonResponse(w, map[string]string{"status": "failure", "reason": reason})
		return
	}

	logger.Println("Reset password code and user found")

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
		logger.Println("unable to insert: ", err)
		sendStringJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	// Delete completed reset request from database
	deleteRequestRec(userID)
	sendStringJsonResponse(w, map[string]string{"status": "success"})
}

func deleteRequestRec(userID int) string {
	query := "DELETE FROM password_reset_requests WHERE user_id = $1"
	if _, err := pool.Exec(context.Background(), query, userID); err != nil {
		logger.Println("unable to delete request record: ", err)
		return "failure"
	}
	return "success"
}

func deleteActivationRec(email string) string {
	query := "DELETE FROM pending_activations WHERE email = $1"
	if _, err := pool.Exec(context.Background(), query, email); err != nil {
		logger.Println("unable to delete activation record: ", err)
		return "failure"
	}
	return "success"
}

func activateUser(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := store.Get(r, "session")
	type contentModel struct {
		Code  string `json:"code"`
		Email string `json:"email"`
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
	logger.Println("activation code received: ", cm.Code)
	// Move user from pending activations to user if code is found
	query := "SELECT username, encrypted_pw, expiry FROM pending_activations WHERE activation_code = $1 AND email = $2"
	var username, encryptedPW string
	var expiry int64
	recordFound := true
	status := "success"
	if err = pool.QueryRow(context.Background(), query, cm.Code, cm.Email).Scan(&username, &encryptedPW, &expiry); err != nil {
		logger.Println("query error: ", err)
		recordFound = false
		status = "failure"
	}
	logger.Println("now: ", time.Now().Unix())
	logger.Println("expiry: ", expiry)
	// If row was not found, expiry will be 0
	if expiry != 0 && time.Now().Unix() > expiry {
		logger.Println("Activation code has expired")
		status = "failure"
		// delete expired record
		deleteActivationRec(cm.Email)
	}

	type responseModel struct {
		Status string `json:"status"`
	}

	userID := -1
	if recordFound {
		deleteActivationRec(cm.Email)
		query = "INSERT INTO users(username, email, encrypted_pw) VALUES($1, $2, $3) RETURNING id;"
		if err := pool.QueryRow(context.Background(), query, username, cm.Email, encryptedPW).Scan(&userID); err != nil {
			logger.Println("unable to insert user data: ", err)
			status = "failure"
		}
	}

	if userID == -1 {
		logger.Println("User ID not retrieved")
	}

	session.Values["auth"] = true
	session.Values["email"] = cm.Email
	session.Values["username"] = username
	session.Values["userID"] = userID
	if err = session.Save(r, w); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := &responseModel{
		Status: status,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func signUp(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	// TODO: Remove the baseURL stuff from here and js request --
	// we are no longer sending a link... just the code
	// Activation timeout in minutes
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
	logger.Println("credentials: ", cm.Username, cm.Email, cm.PlainTextPW)
	logger.Println("baseURL: ", cm.BaseURL)
	pepperedPW := cm.PlainTextPW + os.Getenv("PWPEPPER")
	encryptedPW, err := bcrypt.GenerateFromPassword([]byte(pepperedPW),
		bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}

	expiry := time.Now().Add(activationTimeout * time.Minute).Unix()
	code := generateRandomCode()

	// Check whether user has already registered
	var emailUsed bool
	query := "SELECT 1 FROM users WHERE email = $1"
	var tmp int
	if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&tmp); err == nil {
		// Will throw error if no records found
		logger.Printf("email %s already registered", cm.Email)
		emailUsed = true
	} else {
		query = "SELECT 1 FROM pending_activations WHERE email = $1"
		var tmp int
		if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&tmp); err == nil {
			// Will throw error if no records found
			logger.Printf("email %s is pending activation", cm.Email)
			emailUsed = true
		}
	}

	if !emailUsed {
		query = "INSERT INTO pending_activations(username, email, encrypted_pw, activation_code, expiry, code_resends) VALUES($1, $2, $3, $4, $5, $6)"
		if _, err := pool.Exec(context.Background(), query, cm.Username, cm.Email, encryptedPW, code, expiry, 0); err != nil {
			logger.Println("unable to insert activation request: ", err)
		}

		// Automatically delete activation request after timeout
		// TODO: Stop this goroutine when the activation request is
		// deleted normally
		go func() {
			for {
				time.Sleep(1 * time.Minute)
				if time.Now().Unix() > expiry {
					deleteActivationRec(cm.Email)
					break
				}
			}
		}()

		sendVerificationEmail(code)
	}

	type responseModel struct {
		EmailUsed bool `json:"emailUsed"`
	}
	response := &responseModel{
		EmailUsed: emailUsed,
	}
	jsonResp, err := json.Marshal(response)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}

	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func resendVerificationEmail(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Email string `json:"email"`
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

	status := "success"
	var reason string

	// Check/update code resends
	var codeResends int
	query := "SELECT code_resends FROM pending_activations WHERE email = $1"
	if err := pool.QueryRow(context.Background(), query, cm.Email).Scan(&codeResends); err != nil {
		// Will throw error if no record found (i.e., activation
		// request expired and deleted)
		logger.Println("Select query error: ", err)
		status = "failure"
		reason = "expired"
	} else if codeResends > 2 {
		status = "failure"
		reason = "exceeded"
	}

	if status == "failure" {
		logger.Println(reason)
		sendStringJsonResponse(w, map[string]string{"status": status, "reason": reason})
		return
	}

	query = "UPDATE pending_activations SET code_resends = $1 WHERE email = $2"
	if _, err := pool.Exec(context.Background(), query, codeResends+1, cm.Email); err != nil {
		logger.Println("Unable to update code_resends: ", err)
		status = "failure"
		reason = "database error"
	}

	// Update activation code
	activationCode := generateRandomCode()
	query = "UPDATE pending_activations SET activation_code = $1 WHERE email = $2"
	if _, err := pool.Exec(context.Background(), query, activationCode, cm.Email); err != nil {
		logger.Println("Unable to update activation code: ", err)
		status = "failure"
		reason = "database error"
	}

	// Update expiry
	expiry := time.Now().Add(activationTimeout * time.Minute).Unix()
	query = "UPDATE pending_activations SET expiry = $1 WHERE email = $2"
	if _, err := pool.Exec(context.Background(), query, expiry, cm.Email); err != nil {
		logger.Println("Unable to update expiry: ", err)
		status = "failure"
		reason = "database error"
	}

	sendVerificationEmail(activationCode)
	sendStringJsonResponse(w, map[string]string{"status": status, "reason": reason})
}

func doesRoomExist(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	var exists bool
	if _, found := rooms[roomID]; found {
		exists = true
	} else {
		exists = false
	}
	sendBoolJsonResponse(w, map[string]bool{"roomExists": exists})
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
	writeToWebsockets([]byte("\r\n\r\nRunning your code...\r\n"), roomID)
	room.echo = false
	switch lang {
	case "ruby":
		cn.runner.Write([]byte("exec $0\n")) // reset repl
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			// The following cmd depends on the following ~/.pryrc file
			// on the runner server:
			// def run_code(filename)
			//   puts 'START'; load filename; Pry.history.clear
			// end
			cn.runner.Write([]byte("run_code('code.rb');\n"))
		})
		room.setEventListener("startOutput", func(config eventConfig) {
			room.removeEventListener("startOutput")
			room.echo = true
		})
	case "postgres":
		cn.runner.Write([]byte("\\i code.sql\n"))
		room.setEventListener("newline", func(config eventConfig) {
			if config.count == 1 {
				room.echo = true
				room.removeEventListener("newline")
			}
		})
	case "node":
		cn.runner.Write([]byte(".runUserCode code.js\n"))

		// Turn echo back on right before output begins
		room.setEventListener("newline", func(config eventConfig) {
			lines, err := strconv.Atoi(linesOfCode)
			if err != nil {
				logger.Println("strconv error: ", err)
			}
			if config.count == lines+2 {
				room.echo = true
				room.removeEventListener("newline")
			}
		})
	}
}

func updateCodeSessions(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := store.Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var userID int
	var ok bool
	if userID, ok = session.Values["userID"].(int); !ok {
		logger.Println("userID not found")
		userID = -1
	}

	if userID == -1 {
		sendStringJsonResponse(w, map[string]string{"status": "no update"})
		return
	}

	// This method is called through the api by the CodeSessions
	// component to check whether the user has recently exited any
	// rooms (as they are at that point on the home page) If user
	// is the creator of any rooms, don't close those rooms (they
	// will close automatically if they are empty), but consider
	// that the session has been last accessed at the time of exit,
	// which in this case is the time this method is called
	var sessionsToUpdate []int
	for _, room := range rooms {
		if room.creatorUserID == userID {
			sessionsToUpdate = append(sessionsToUpdate, room.codeSessionID)
		}
	}

	for _, codesessID := range sessionsToUpdate {
		updateRoomAccessTime(codesessID)
		logger.Println("updating access time for code session ID: ", codesessID)
	}

	sendStringJsonResponse(w, map[string]string{"status": "success"})
}

func updateRoomAccessTime(codeSessionID int) {
	query := "UPDATE coding_sessions SET when_accessed = $1 WHERE id = $2"
	currentTime := time.Now().Unix()
	if _, err := pool.Exec(context.Background(), query, currentTime, codeSessionID); err != nil {
		logger.Println("Error in updating coding_sessions when_accessed timestamp: ", err)
	}
}

func closeEmptyRooms() {
	toDelete := []string{}
	for roomID, room := range rooms {
		// logger.Println("checking for empty rooms")
		logger.Println("container: ", room.container.ID, "  websockets: ", len(room.wsockets))
		if len(room.wsockets) == 0 {
			logger.Println("removing room container: ", room.container.ID)
			// Update room access time if code session associated with it
			if room.codeSessionID != -1 {
				updateRoomAccessTime(room.codeSessionID)
			}
			// Close hijacked connection with runner
			closeContainerConnection(room.container.connection)
			// Remove room container
			err := stopAndRemoveContainer(room.container.ID)
			if err != nil {
				logger.Println("error in stopping/removing container: ", err)
			}
			// Record roomID for deletion
			toDelete = append(toDelete, roomID)
			// Remove empty rooms
			for _, id := range toDelete {
				delete(rooms, id)
			}
			// TODO: remove this println
			logger.Println("number of rooms open: ", len(rooms))
		}
	}
}

// Remove old unused containers/close rooms
func startRoomCloser() {
	const checkInterval = 60 // Time between checks in seconds
	go func() {
		for {
			time.Sleep(checkInterval * time.Second)
			closeEmptyRooms()
		}
	}()
}

func stopAndRemoveContainer(containername string) error {
	logger.Println("Removing container: ", containername)
	ctx := context.Background()

	// close connection

	if err := cli.ContainerStop(ctx, containername, nil); err != nil {
		logger.Printf("Unable to stop container %s: %s", containername, err)
	}

	removeOptions := types.ContainerRemoveOptions{
		// RemoveVolumes: true,
		Force: true,
	}

	if err := cli.ContainerRemove(ctx, containername, removeOptions); err != nil {
		logger.Printf("Unable to remove container: %s", err)
		return err
	}

	return nil
}

func main() {
	initClient()
	initSesClient()
	initDBConnectionPool()
	startRoomCloser()
	store.Options = &sessions.Options{
		SameSite: http.SameSiteStrictMode,
	}
	router := httprouter.New()
	router.POST("/api/savecontent", saveContent)
	// FIXME: Should this be a POST (is it really idempotent)?
	router.GET("/api/openws", openWs)
	router.POST("/api/createroom", createRoom)
	router.POST("/api/prepare-room", prepareRoom)
	router.POST("/api/activateuser", activateUser)
	router.GET("/api/does-room-exist", doesRoomExist)
	router.GET("/api/get-initial-room-data", getInitialRoomData)
	router.GET("/api/get-room-status", getRoomStatus)
	router.GET("/api/get-user-info", getUserInfo)
	router.POST("/api/switchlanguage", switchLanguage)
	router.POST("/api/runfile", runFile)
	router.POST("/api/sign-up", signUp)
	router.POST("/api/sign-in", signIn)
	router.POST("/api/sign-out", signOut)
	router.POST("/api/resend-verification-email", resendVerificationEmail)
	router.POST("/api/forgot-password", forgotPassword)
	router.POST("/api/reset-password", resetPassword)
	router.POST("/api/clientclearterm", clientClearTerm)
	router.POST("/api/save-code-session", saveCodeSession)
	router.POST("/api/update-code-sessions", updateCodeSessions)
	router.GET("/api/get-code-sessions", getCodeSessions)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	logger.Printf("Starting server on port %d\n", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

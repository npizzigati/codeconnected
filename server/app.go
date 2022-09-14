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
	ttyRows             int
	ttyCols             int
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
	timeoutTimer     *time.Timer
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
var welcomeMessages = map[string][]byte{
	"ruby":     []byte(""),
	"node":     []byte("Welcome to Node.js.\r\nType \".help\" for more information.\r\n"),
	"postgres": []byte("psql\r\nType \"help\" for help.\r\n"),
}
var initialPrompts = map[string][]byte{
	"ruby":     []byte("[1] pry(main)> "),
	"node":     []byte("> "),
	"postgres": []byte("codeuser=> "),
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
	type responseModel struct {
		Language        string `json:"language"`
		History         string `json:"history"`
		Expiry          int64  `json:"expiry"`
		IsAuthedCreator bool   `json:"isAuthedCreator"`
	}

	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	if _, ok := rooms[roomID]; !ok {
		logger.Printf("Room %s does not exist", roomID)
	}

	lang := rooms[roomID].lang
	hist := rooms[roomID].termHist
	expiry := rooms[roomID].expiry

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

	isAuthedCreator := false
	if userID != -1 && userID == rooms[roomID].creatorUserID {
		isAuthedCreator = true
	}

	response := &responseModel{
		Language:        lang,
		History:         string(hist),
		Expiry:          expiry,
		IsAuthedCreator: isAuthedCreator,
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
		SessionCount int           `json:"sessionCount"`
		CodeSessions []codeSession `json:"codeSessions"`
	}

	var cSession codeSession
	var cSessions []codeSession
	var id int32
	var lang string
	var content string
	var when_accessed int64
	sessionCount := 0
	queryLines :=
		[]string{
			"SELECT id, lang, editor_contents, when_accessed",
			"FROM coding_sessions WHERE user_id = $1",
			"ORDER BY when_accessed DESC LIMIT 5"}
	query := strings.Join(queryLines, " ")
	rows, err := pool.Query(context.Background(), query, userID)
	if err != nil {
		logger.Println("Query unsuccessful: ", err)
	}
	for rows.Next() {
		sessionCount += 1
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

	logger.Println("Number of code sessions found: ", sessionCount)
	response := &responseModel{
		SessionCount: sessionCount,
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &csm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	logger.Println("content: ", csm.Content)
	logger.Println("codeSessionID: ", csm.CodeSessionID)

	query := "UPDATE coding_sessions SET editor_contents = $1 WHERE id = $2"
	if _, err := pool.Exec(context.Background(), query, csm.Content, csm.CodeSessionID); err != nil {
		logger.Println("unable to update content in coding_sessions: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	sendJsonResponse(w, map[string]string{"status": "success"})
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
		if rm.CodeSessionID != -1 && r.codeSessionID == rm.CodeSessionID {
			roomID = k
			sendJsonResponse(w, map[string]string{"roomID": roomID})
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

	sendJsonResponse(w, map[string]string{"roomID": roomID})
}

func getRoomStatus(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")

	status := rooms[roomID].status
	sendJsonResponse(w,
		map[string]string{
			"status": status,
		})
}

func getCodeSessionID(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type paramsModel struct {
		RoomID string
	}
	var pm paramsModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	room := rooms[pm.RoomID]
	sendJsonResponse(w, map[string]int{"codeSessionID": room.codeSessionID})
}

// Delete room in preparation that hasn't become ready after
// timeout
// func createUnsuccessfulRoomCloser(roomID string) *time.Timer {
// 	prepTimeout := 20
// 	closer := time.NewTimer(time.Duration(prepTimeout) * time.Second)
// 	go func() {
// 		<-closer.C
// 		// Close room if it still exists
// 		closeRoom(roomID)
// 	}()
// 	return closer
// }

func setRoomStatusOpen(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
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

	rooms[rm.RoomID].status = "open"
	logger.Printf("Room %s is %s\n", rm.RoomID, rooms[rm.RoomID].status)
}

func createContainer(ctx context.Context, cmd []string, createContainerChan chan<- container.ContainerCreateCreatedBody) {
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
		logger.Println("Error in creating container: ", err)
		return
	}
	createContainerChan <- resp
}

func prepareRoom(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type roomModel struct {
		RoomID string
		Rows   int
		Cols   int
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

	type responseModel struct {
		Status         string `json:"status"`
		CodeSessionID  int    `json:"codeSessionID"`
		InitialContent string `json:"initialContent"`
	}

	roomID := rm.RoomID
	room := rooms[roomID]

	// Room can only be prepared once. If the link is shared before
	// room is prepared, this request could be made by a second
	// user. Guard against that.
	if room.status == "preparing" {
		sendJsonResponse(w, &responseModel{Status: room.status})
		return
	}

	// Close room and notify user if not successfully created in x seconds
	prepTimeout := 8
	failedStartCloser := time.NewTimer(time.Duration(prepTimeout) * time.Second)
	room.status = "preparing"
	logger.Println("*************rm.RoomID: ", rm.RoomID)
	logger.Println("**************Going to start container********************")
	if err = startContainer(room.lang, roomID, rm.Rows, rm.Cols, failedStartCloser); err != nil {
		logger.Printf("Error starting container for room %s: %s\n", roomID, err)
		room.status = "failed"
		logger.Println("********Room preparation failed. Room will be closed********")
		closeRoom(roomID)
		sendJsonResponse(w, &responseModel{Status: room.status})
		return
	}

	session, err := store.Get(r, "session")
	if err != nil {
		logger.Println("Error retrieving status: ", err)
		// TODO: Replace this http error with a meaningful json
		// response to be handled by the front end
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// If creating user is not authed, set expiry on room
	var auth, ok bool
	var expiry int64
	if auth, ok = session.Values["auth"].(bool); !ok || !auth {
		logger.Println("Unauthed user")
		expiry = time.Now().Add(anonRoomTimeout * time.Minute).Unix()
	} else {
		expiry = -1
	}
	room.expiry = expiry

	// TODO: Would a timer be simpler here?
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
						closeRoom(roomID)
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

	failedStartCloser.Stop()

	logger.Printf("Room %s is ready\n", roomID)
	room.status = "ready"

	sendJsonResponse(w, &responseModel{
		Status:         "ready",
		CodeSessionID:  room.codeSessionID,
		InitialContent: room.initialContent,
	})
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
		if err := ws.Ping(ctx); err != nil {
			// Retry ping to account for the case where a client
			// temporary disconnects (or refreshes the page) at exact
			// instance of ping
			time.Sleep(2 * time.Second)
			if err := ws.Ping(ctx); err != nil {
				ws.Close(websocket.StatusInternalError, "websocket no longer available")
				logger.Println("---------------------Pong NOT received---------------------")

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
		resetTerminal(roomID)
		displayInitialPrompt(roomID, true, "1")
	}

	go heartbeat(context.Background(), ws, heartbeatTime*time.Second, room)

	// Websocket receive loop
	for {
		// Receive command
		_, message, err := ws.Read(context.Background())
		if err != nil {
			logger.Println("error receiving message: ", err, " ", time.Now().String())
			// TODO: -- I should try to recover after this (reopen
			// ws?). I don't think so
			break
		}

		sendToContainer(message, roomID)
	}
}

func startRunnerReader(roomID string) {
	logger.Println("Starting runner reader")

	var room *room
	var ok bool
	if room, ok = rooms[roomID]; !ok {
		logger.Printf("room %s does not exist", roomID)
		// TODO: Abort here (and abort in other functions where room
		// is found not to exist)
	}

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
				_, err := cn.bufReader.Discard(8)
				if err != nil {
					logger.Println("error in discarding header: ", err)
				}
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
				newlineCount++
				room.emit("newline", eventConfig{count: newlineCount})
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
	room := rooms[roomID]
	// Also write to history if at least one client connected
	if len(room.wsockets) > 0 {
		// Don't write special messages to history
		textString := string(text)
		if textString != "RESETTERMINAL" &&
			textString != "RUNDONE" &&
			textString != "CANCELRUN" &&
			textString != "RUNTIMEOUT" {
			room.termHist = append(room.termHist, text...)
		}
	}

	for _, ws := range room.wsockets {
		err := ws.Write(context.Background(), websocket.MessageText, text)
		if err != nil {
			logger.Println("ws write err: ", "text", text, "; err: ", err)
		}
	}
}

func sendToContainer(message []byte, roomID string) {
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

func startContainer(lang, roomID string, rows int, cols int, failedStartCloser *time.Timer) error {
	room := rooms[roomID]
	cn := room.container
	ctx := context.Background()
	cmd := []string{"bash"}
	var resp container.ContainerCreateCreatedBody

	logger.Println("********About to call createContainer for room: ", roomID)
	createContainerChan := make(chan container.ContainerCreateCreatedBody)
	// Creating the container can take a long time (> 20 sec) if tcp
	// connection with runner is down, so we set up a race and see
	// if the failed start closer timeout finishes first
	go func() {
		createContainer(ctx, cmd, createContainerChan)
	}()
	select {
	case <-failedStartCloser.C:
		return errors.New("Container creation timed out")
	case resp := <-createContainerChan:
		logger.Println("********resp from attempt to create container: ", resp)
	}
	if err := cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
		logger.Println("Error in starting container: ", err)
		// panic(err)
	}

	logger.Println("Setting new container id to: ", resp.ID)
	cn.ID = resp.ID

	logger.Println("Will try to set rows to: ", rows)
	if err := resizeTTY(cn, cols, rows); err != nil {
		logger.Println("Error setting initial tty size: ", err)
	}
	// Sql container needs a pause to startup postgres
	// This will give openLanguageConnection a better chance of
	// correctly opening psql on the first try
	if lang == "postgres" {
		time.Sleep(3 * time.Second)
	}
	if err := openLanguageConnection(lang, roomID); err != nil {
		return err
	}
	return nil
}

func resizeTTY(cn *containerDetails, cols, rows int) error {
	ctx := context.Background()
	resizeOpts := types.ResizeOptions{
		Height: uint(rows),
		Width:  uint(cols),
	}

	if err := cli.ContainerResize(ctx, cn.ID, resizeOpts); err != nil {
		return err
	}
	return nil
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
	var r *room
	var ok bool
	if r, ok = rooms[roomID]; !ok {
		return errors.New("room does not exist")
	}
	r.echo = false
	// Number of attempts to make
	maxTries := 5
	tries := 0
	// Wait until prompt is ready
	waitTime := 4000
	success := make(chan struct{})
	r.setEventListener("promptReady", func(config eventConfig) {
		logger.Printf("Prompt ready in room %s. Should stop attempts to open lang connection now.", roomID)
		close(success)
		r.removeEventListener("promptReady")
	})
loop:
	for {
		logger.Println("Attempting language connection")
		// Do not attempt language connection if room does not exist anymore
		if _, ok := rooms[roomID]; !ok {
			logger.Println("Room no longer exists")
			break loop
		}
		attemptLangConn(lang, roomID)
		select {
		case <-success:
			logger.Printf("Stopping loop to attempt language connection")
			r.echo = true
			resetTerminal(roomID)
			displayInitialPrompt(roomID, true, "1")
			return nil
		case <-time.After(time.Duration(waitTime) * time.Millisecond):
			tries++
			if tries >= maxTries {
				break loop
			}
		}
	}
	return errors.New("unable to open language connection (could not get prompt)")
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
	var room *room
	var ok bool
	if room, ok = rooms[roomID]; !ok {
		logger.Printf("room %s does not exist", roomID)
	}
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

func displayInitialPrompt(roomID string, welcome bool, promptNum string) {
	lang := rooms[roomID].lang
	var message, intro []byte
	switch lang {
	case "ruby":
		intro = welcomeMessages["ruby"]
		// Replace line number with correct line number (i.e., it's
		// not always 1, as in when we interrupt execution due to
		// timeout and then print prompt)
		message = bytes.Replace(initialPrompts["ruby"], []byte("1"), []byte(promptNum), 1)
	case "node":
		intro = welcomeMessages["node"]
		message = initialPrompts["node"]
	case "postgres":
		intro = welcomeMessages["postgres"]
		message = initialPrompts["postgres"]
	}
	if welcome {
		writeToWebsockets(intro, roomID)
	}
	writeToWebsockets(message, roomID)
}

// TODO: make this a room method
func resetTerminal(roomID string) {
	writeToWebsockets([]byte("RESETTERMINAL"), roomID)
	// Also reset terminal history
	rooms[roomID].termHist = []byte("")
	if rooms[roomID].timeoutTimer != nil {
		rooms[roomID].timeoutTimer.Stop()
	}
	writeToWebsockets([]byte("CANCELRUN"), roomID)
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

	sendJsonResponse(w, map[string]string{"status": "success"})
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
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
	sendJsonResponse(w, map[string]string{"status": "success"})
}

func generateRandomCode() string {
	max := 999999
	min := 100000
	rand.Seed(time.Now().UnixNano())
	return strconv.Itoa(rand.Intn(max-min) + min)
}

func sendJsonResponse(w http.ResponseWriter, data interface{}) {
	jsonResp, err := json.Marshal(data)
	if err != nil {
		logger.Println("err in marshaling: ", err)
	}
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
		sendJsonResponse(w, map[string]string{"status": "failure", "reason": reason})
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	// Delete completed reset request from database
	deleteRequestRec(userID)
	sendJsonResponse(w, map[string]string{"status": "success"})
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
	// Will throw errow if code is not found
	if err = pool.QueryRow(context.Background(), query, cm.Code, cm.Email).Scan(&username, &encryptedPW, &expiry); err != nil {
		logger.Println("query error: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	logger.Println("now: ", time.Now().Unix())
	logger.Println("expiry: ", expiry)
	if time.Now().Unix() > expiry {
		logger.Println("Activation code has expired")
		// delete expired record
		deleteActivationRec(cm.Email)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	userID := -1
	deleteActivationRec(cm.Email)
	query = "INSERT INTO users(username, email, encrypted_pw) VALUES($1, $2, $3) RETURNING id;"
	if err := pool.QueryRow(context.Background(), query, username, cm.Email, encryptedPW).Scan(&userID); err != nil {
		logger.Println("unable to insert user data: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	if userID == -1 {
		logger.Println("User ID could not be retrieved")
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	session.Values["auth"] = true
	session.Values["email"] = cm.Email
	session.Values["username"] = username
	session.Values["userID"] = userID
	if err = session.Save(r, w); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sendJsonResponse(w, map[string]string{"status": "success"})
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
		sendJsonResponse(w, map[string]string{"status": status, "reason": reason})
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
	sendJsonResponse(w, map[string]string{"status": status, "reason": reason})
}

func doesRoomExist(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	var exists bool
	if _, found := rooms[roomID]; found {
		exists = true
		logger.Printf("room %s does exist", roomID)
	} else {
		exists = false
	}
	sendJsonResponse(w, map[string]bool{"roomExists": exists})
}

func runCode(roomID string, lang string, linesOfCode int, promptLineEmpty bool) {
	room := rooms[roomID]
	cn := room.container
	// Max run time in seconds
	const maxRunTime = 10

	room.echo = false
	if !promptLineEmpty {
		cn.runner.Write([]byte("\x03")) // send ctrl-c
	}

	writeToWebsockets([]byte("\r\n\r\nRunning your code...\r\n"), roomID)

	// Emit run timeout after x seconds to prevent long-running code
	room.timeoutTimer = time.NewTimer(maxRunTime * time.Second)
	go func() {
		<-room.timeoutTimer.C
		// Send ctrl-c interrupt
		room.echo = false
		cn.runner.Write([]byte("\x03")) // send ctrl-c
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			writeToWebsockets([]byte("CANCELRUN"), roomID)
			writeToWebsockets([]byte("\r\nExecution interrupted because time limit exceeded.\r\n"), roomID)
			displayInitialPrompt(roomID, false, "2")
			room.echo = true
		})
	}()

	switch lang {
	case "ruby":
		cn.runner.Write([]byte("exec $0\n")) // reset repl
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			// The following cmd depends on run_codeconnected_code method in ~/.pryrc
			// file on the runner server:
			cn.runner.Write([]byte("run_codeconnected_code('code.rb');\n"))
		})
		room.setEventListener("startOutput", func(config eventConfig) {
			room.removeEventListener("startOutput")
			room.echo = true
			room.emit("runOutputStarted", eventConfig{})
		})
	case "postgres":
		cn.runner.Write([]byte("\\i code.sql\n"))
		room.setEventListener("newline", func(config eventConfig) {
			if config.count == 1 {
				room.removeEventListener("newline")
				room.echo = true
				room.emit("runOutputStarted", eventConfig{})
			}
		})
	case "node":
		cn.runner.Write([]byte(".runUserCode code.js\n"))

		// Turn echo back on right before output begins
		extraLinesBeforeStdOutput := 2
		// Account for output workaround (adding null; on newline at
		// end of file) in custom node launcher
		linesAddedInCustomNodeLauncher := 1
		room.setEventListener("newline", func(config eventConfig) {
			if config.count == linesOfCode+extraLinesBeforeStdOutput+linesAddedInCustomNodeLauncher {
				room.removeEventListener("newline")
				room.echo = true
				room.emit("runOutputStarted", eventConfig{})
			}
		})
	}
	room.setEventListener("runOutputStarted", func(config eventConfig) {
		logger.Println("********Run output started*********")
		room.removeEventListener("runOutputStarted")
		room.setEventListener("promptReady", func(config eventConfig) {
			logger.Println("********Run done*********")
			room.removeEventListener("promptReady")
			room.timeoutTimer.Stop()
			writeToWebsockets([]byte("RUNDONE"), roomID)
		})
	})
}

func deleteReplHistory(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type paramsModel struct {
		RoomID string
		Lang   string
	}
	var pm paramsModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	roomID := pm.RoomID
	room := rooms[roomID]
	cn := room.container
	lang := pm.Lang

	switch lang {
	case "ruby":
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			room.echo = true
		})
		room.echo = false
		cn.runner.Write([]byte("clear_history;\n"))
	case "node":
		room.setEventListener("promptReady", func(config eventConfig) {
			room.removeEventListener("promptReady")
			room.echo = true
		})
		room.echo = false
		cn.runner.Write([]byte(".deleteHistory\n"))
	}

	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte("Successfully deleted repl history"))
}

func runFile(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type paramsModel struct {
		Filename        string
		Lines           int
		RoomID          string
		Lang            string
		PromptLineEmpty bool
	}
	var pm paramsModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	runCode(pm.RoomID, pm.Lang, pm.Lines, pm.PromptLineEmpty)
}

func updateCodeSession(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	logger.Println("Going to update code session")
	type paramsModel struct {
		CodeSessionID int
		Language      string
		Content       string
	}
	var pm paramsModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logger.Println("err reading json: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		logger.Println("err while trying to unmarshal: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	logger.Printf("In code session updated function. csID: %d, lang: %s, content: %s", pm.CodeSessionID, pm.Language, pm.Content)
	if err = runSessionUpdateQuery(pm.CodeSessionID, pm.Language, pm.Content); err != nil {
		logger.Println("error in updating code session: ", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	sendJsonResponse(w, map[string]string{"status": "success"})
}

func runSessionUpdateQuery(codeSessionID int, language string, content string) error {
	query := "UPDATE coding_sessions SET when_accessed = $1, lang = $2, editor_contents = $3 WHERE id = $4"
	currentTime := time.Now().Unix()
	if _, err := pool.Exec(context.Background(), query, currentTime, language, content, codeSessionID); err != nil {
		return err
	}
	return nil
}

func updateRoomAccessTime(codeSessionID int) {
	query := "UPDATE coding_sessions SET when_accessed = $1 WHERE id = $2"
	currentTime := time.Now().Unix()
	if _, err := pool.Exec(context.Background(), query, currentTime, codeSessionID); err != nil {
		logger.Println("Error in updating coding_sessions when_accessed timestamp: ", err)
	}
}

func closeEmptyRooms() {
	// Remove rooms where there are no users
	for roomID, room := range rooms {
		logger.Println("roomID: ", roomID, "status: ", room.status, "container: ", room.container.ID, "  websockets: ", len(room.wsockets))
		// Check if room container exists to make sure we're not
		// deleting rooms that are in the process of being created
		if len(room.wsockets) == 0 && room.status == "open" {
			closeRoom(roomID)
		}
	}
}

func closeRoom(roomID string) {
	var room *room
	var ok bool
	// Do nothing if room does not exist
	if room, ok = rooms[roomID]; !ok {
		return
	}
	logger.Println("remove room: ", roomID)
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
	// Remove empty room from rooms map
	delete(rooms, roomID)
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
	router.POST("/api/delete-repl-history", deleteReplHistory)
	router.POST("/api/sign-up", signUp)
	router.POST("/api/sign-in", signIn)
	router.POST("/api/sign-out", signOut)
	router.POST("/api/resend-verification-email", resendVerificationEmail)
	router.POST("/api/forgot-password", forgotPassword)
	router.POST("/api/reset-password", resetPassword)
	router.POST("/api/clientclearterm", clientClearTerm)
	router.POST("/api/save-code-session", saveCodeSession)
	router.POST("/api/update-code-session", updateCodeSession)
	router.GET("/api/get-code-sessions", getCodeSessions)
	router.POST("/api/get-code-session-id", getCodeSessionID)
	router.POST("/api/set-room-status-open", setRoomStatusOpen)
	port := 8080
	portString := fmt.Sprintf("0.0.0.0:%d", port)
	logger.Printf("Starting server on port %d\n", port)

	handler := cors.Default().Handler(router)
	err := http.ListenAndServe(portString, handler)
	if err != nil {
		panic(err)
	}
}

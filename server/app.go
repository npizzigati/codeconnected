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
	"github.com/gorilla/sessions"
	"github.com/jackc/pgx/v4/pgxpool"
	"github.com/julienschmidt/httprouter"
	"github.com/rs/cors"
	"io"
	"log"
	"net"
	"net/http"
	"nhooyr.io/websocket"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type containerExecCreateError struct {
	dockerErrMessage string
}

func (e containerExecCreateError) Error() string {
	return fmt.Sprintf("ExecCreate error (original Docker err: %s)", e.dockerErrMessage)
}

type containerExecAttachError struct {
	dockerErrMessage string
}

func (e containerExecAttachError) Error() string {
	return fmt.Sprintf("ExecAttach error (original Docker err: %s)", e.dockerErrMessage)
}

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

type room struct {
	wsockets         []*websocket.Conn
	creatorUserID    int
	lang             string
	codeSessionID    int
	initialContent   string
	replVersionInfo  string
	echo             bool
	runTimeoutTimer  *time.Timer
	abortRunChan     chan struct{}
	container        *containerDetails
	eventSubscribers map[string]func()
	termHist         []byte
	termRows         int
	termCols         int
	status           string
	lastExistCheck   int64
	expiry           int64
}

func (r *room) emit(event string) {
	if callback, ok := r.eventSubscribers[event]; ok {
		callback()
	}
}

func (r *room) setEventListener(event string, callback func()) {
	if r.eventSubscribers == nil {
		r.eventSubscribers = make(map[string]func())
	}
	r.eventSubscribers[event] = callback
}

func (r *room) removeEventListener(event string) {
	delete(r.eventSubscribers, event)
}

// Enables synchronous execution of a certain side effect of the
// passed in function. Will block until the passed in event
// triggers.  We need to specify whether we are going to toggle
// room echo here (turn it off before function, if not already
// off, and back on after the side effect event triggers) because
// in some cases, such as in switching on the room output when
// run output starts, it is essential to switch room echo back on
// nearly instantaneously, or else it will be turned on after a
// delay, and some data will not be echoed. (Channels are
// relatively slow, and turning the echo back on when this method
// returns is not fast enough.)
//
// If no function is passed in (anonymous function with no body),
// we just wait for the side effect, without running any function
// that might cause it.
func (r *room) awaitSideEffect(sideEffectEvent string, funcWithSideEffect func(),
	timeout time.Duration, shouldToggleEcho bool) error {
	// Timeout
	timer := time.NewTimer(timeout)
	waitChan := make(chan struct{})
	if shouldToggleEcho && r.echo {
		r.echo = false
	}
	r.setEventListener(sideEffectEvent, func() {
		if shouldToggleEcho {
			r.echo = true
		}
		r.removeEventListener(sideEffectEvent)
		close(waitChan)
	})
	// preEventFunc will run *first*, and then event will trigger
	// at some point in time (generally, preEventFunc will
	// indirectly cause event to trigger)
	funcWithSideEffect()
	select {
	case <-waitChan:
		return nil
	case <-timer.C:
		if shouldToggleEcho {
			r.echo = true
		}
		r.removeEventListener(sideEffectEvent)
		return errors.New("Timeout")
	}
}

var cli *client.Client
var rooms = make(map[string]*room)
var store = sessions.NewCookieStore([]byte(os.Getenv("SESS_STORE_SECRET")))
var initialPrompts = map[string][]byte{
	"ruby":     []byte("[1] pry(main)> "),
	"node":     []byte("> "),
	"postgres": []byte("codeuser=> "),
}
var pool *pgxpool.Pool

// Timeouts
const activationTimeout = 5 * time.Minute
const anonRoomTimeout = 20 * time.Minute
const maxRunTime = 10 * time.Second
const runnerStartupTimeout = 13 * time.Second

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

func getDBPool() *pgxpool.Pool {
	return pool
}

func getSessStore() *sessions.CookieStore {
	return store
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
		logger.Printf("Attempt to access room %s, which does not exist", roomID)
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

	sendJsonResponse(w, response)
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
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		if lang, ok = values[1].(string); !ok {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		// If editor_contents is nil, set content to ""
		// (if we don't do this, the type assertion below will fail)
		if values[2] == nil {
			content = ""
		} else if content, ok = values[2].(string); !ok {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		if when_accessed, ok = values[3].(int64); !ok {
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
		SessionCount: sessionCount,
		CodeSessions: cSessions,
	}
	sendJsonResponse(w, response)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	err = json.Unmarshal(body, &rm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

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

	room := room{
		lang:           rm.Language,
		codeSessionID:  rm.CodeSessionID,
		initialContent: rm.InitialContent,
		container:      &containerDetails{},
		status:         "created",
		abortRunChan:   make(chan struct{}),
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	room := rooms[pm.RoomID]
	sendJsonResponse(w, map[string]int{"codeSessionID": room.codeSessionID})
}

func setRoomStatusOpen(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type roomModel struct {
		RoomID string
	}
	var rm roomModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
	err = json.Unmarshal(body, &rm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	rooms[rm.RoomID].status = "open"
	logger.Printf("Room %s is %s\n", rm.RoomID, rooms[rm.RoomID].status)
}

func createContainer(ctx context.Context, cmd []string) (container.ContainerCreateCreatedBody, error) {
	return cli.ContainerCreate(ctx, &container.Config{
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
	err = json.Unmarshal(body, &rm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	room.status = "preparing"
	if err = startUpRunner(room.lang, roomID, rm.Rows, rm.Cols); err != nil {
		logger.Printf("Error starting up container for room %s: %s\n", roomID, err)
		room.status = "failed"
		closeRoom(roomID)
		sendJsonResponse(w, &responseModel{Status: room.status})
		return
	}

	room.termRows = rm.Rows
	room.termCols = rm.Cols

	session, err := store.Get(r, "session")
	if err != nil {
		room.status = "failed"
		closeRoom(roomID)
		sendJsonResponse(w, &responseModel{Status: room.status})
		return
	}

	// If creating user is not authed, set expiry on room
	var auth, ok bool
	var expiry int64
	if auth, ok = session.Values["auth"].(bool); !ok || !auth {
		expiry = time.Now().Add(anonRoomTimeout).Unix()
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
						closeRoom(roomID)
						return
					}
				}
			}
		}()
	}

	var userID int
	if userID, ok = session.Values["userID"].(int); !ok {
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
		displayInitialPrompt(roomID, true, "1")
	}

	go heartbeat(context.Background(), ws, heartbeatTime*time.Second, room)

	// Websocket receive loop
	for {
		// Receive command
		_, message, err := ws.Read(context.Background())
		if err != nil {
			break
		}
		if string(message) == "WSPING" {
			ws.Write(context.Background(), websocket.MessageText, []byte("WSPONG"))
		} else {
			if err := sendToContainer(message, roomID); err != nil {
				writeToWebsockets([]byte("CONTAINERERROR"), roomID)
			}
		}
	}
}

func startRunnerReader(roomID string) {
	var room *room
	var ok bool
	if room, ok = rooms[roomID]; !ok {
		return
	}

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
		logger.Println("Regexp compilation error: ", err)
	}
	promptTermination, err := regexp.Compile("> $")
	if err != nil {
		logger.Println("Regexp compilation error: ", err)
	}
	go func() {
		// Reading from connection
		var timer *time.Timer
		var peek []byte
		var err error
		for {
			// Check for 8-byte docker multiplexing header and discard
			// if present
			peek, err = cn.bufReader.Peek(1)
			// Peek will fail with err == io.EOF when TCP connection
			// with runner goes down (i.e. in unstable connection
			// conditions)
			if err != nil {
				// Stop the run timeout timer, since we've lost
				// connection with the runner, and we don't want this
				// timeout to fire and abortRun to be executed, since
				// abortRun will then timeout waiting for prompt, starting
				// another runner restart process
				if room.runTimeoutTimer != nil {
					room.runTimeoutTimer.Stop()
				}
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
				break
			}
			if err != nil {
				// Runner not connected
				break
			}

			if string(ru) == "\n" {
				newlineCount++
				room.emit("newline" + strconv.Itoa(newlineCount))
			}

			// Add char to fake terminal buffer
			fakeTermBuffer = append(fakeTermBuffer, byteSlice...)

			if bytes.HasSuffix(fakeTermBuffer, []byte("START")) {
				room.emit("startOutput")
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
						room.emit("promptReady")
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
		cn.runnerReaderActive = false
		// Try to reestablish connection if anybody is in room
		// and restart flag is true
		if len(room.wsockets) > 0 && cn.runnerReaderRestart == true {
			// Try to reopen language connection
			if err := openLanguageConnection(room.lang, roomID); err != nil {
				writeToWebsockets([]byte("CONTAINERERROR"), roomID)
			}
		}
	}()
}

func writeToWebsockets(text []byte, roomID string) {
	var room *room
	var ok bool
	if room, ok = rooms[roomID]; !ok {
		return
	}
	// Also write to history if at least one client connected
	if len(room.wsockets) > 0 {
		// Don't write special messages to history
		textString := string(text)
		if textString != "RESETTERMINAL" &&
			textString != "RUNDONE" &&
			textString != "CANCELRUN" &&
			textString != "TIMEOUT" &&
			textString != "CONTAINERERROR" {
			room.termHist = append(room.termHist, text...)
		}
	}

	for _, ws := range room.wsockets {
		err := ws.Write(context.Background(), websocket.MessageText, text)
		if err != nil {
			logger.Println("ws write err:", err, "in room:", roomID)
		}
	}
}

func sendToContainer(message []byte, roomID string) error {
	var room *room
	var ok bool
	if room, ok = rooms[roomID]; !ok {
		myErr := fmt.Sprintf("room %s does not exist", roomID)
		return errors.New(myErr)
		// TODO: Use this error handling wherever room is accessed?
	}
	cn := room.container
	if _, err := cn.runner.Write(message); err != nil {
		myErr := fmt.Sprintf("Runner write error: %s", err)
		return errors.New(myErr)
	}
	return nil
}

func saveContent(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Content  string
		Filename string
		RoomID   string
	}

	var cm contentModel
	var body []byte
	var err error
	body, err = io.ReadAll(r.Body)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	tarBuffer, err := makeTarball([]byte(cm.Content), cm.Filename)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	cn := rooms[cm.RoomID].container

	// Copy contents of user program to container.
	err = cli.CopyToContainer(context.Background(), cn.ID, "/home/codeuser/", &tarBuffer, types.CopyToContainerOptions{})
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	sendJsonResponse(w, map[string]string{"status": "success"})
}

func startUpRunner(lang, roomID string, rows int, cols int) error {
	timer := time.NewTimer(runnerStartupTimeout)
	returnChan := make(chan error)
	go func() {
		var room *room
		var ok bool
		if room, ok = rooms[roomID]; !ok {
			myErr := fmt.Sprintf("room %s does not exist", roomID)
			returnChan <- errors.New(myErr)
			return
		}
		cn := room.container
		ctx := context.Background()
		cmd := []string{"bash"}
		// Creating the container can take a long time (> 20 sec) if tcp
		// connection with runner is down, so we set up a race and see
		// if the timeout timer finishes first
		resp, err := createContainer(ctx, cmd)
		if err != nil {
			returnChan <- err
			return
		}
		if err := cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
			returnChan <- err
			return
		}

		cn.ID = resp.ID

		if err := resizeTTY(cn, cols, rows); err != nil {
			returnChan <- err
			return
		}
		// Sql container needs a pause to startup postgres
		// This will give openLanguageConnection a better chance of
		// correctly opening psql on the first try
		if lang == "postgres" {
			time.Sleep(5 * time.Second)
		}
		if err := openLanguageConnection(lang, roomID); err != nil {
			returnChan <- err
			return
		}
		returnChan <- nil
	}()
	select {
	case returnValue := <-returnChan:
		return returnValue
	case <-timer.C:
		return errors.New("Container startup timed out")
	}
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
	if room.runTimeoutTimer != nil {
		room.runTimeoutTimer.Stop()
	}

	// Chose abort chan to signal to runCode to abort run and send
	// http response (if we were running code when runner restarted)
	close(room.abortRunChan)
	// Immediately reassign a new chan for the next use
	room.abortRunChan = make(chan struct{})

	// Set the restart flag to false so that the reader doesn't
	// automatically restart when we close the connection
	cn.runnerReaderRestart = false
	// Connection must be closed here to switch language
	// since this will end runner loop (runner peek will return a
	// tcp error -- use of a closed connection)
	cn.connection.Close()

	// Wait until runner reader is inactive
	runnerReaderInactiveChan := make(chan struct{})
	go func() {
		for {
			if !cn.runnerReaderActive {
				close(runnerReaderInactiveChan)
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()
	<-runnerReaderInactiveChan

	err := openLanguageConnection(lang, roomID)
	if err != nil {
		writeToWebsockets([]byte("CONTAINERERROR"), roomID)
	}
	// TODO: Return a failure status if we fail to switch rooms
	// within a certain time limit
	sendJsonResponse(w, map[string]string{"status": "done"})
}

func openLanguageConnection(lang, roomID string) error {
	var r *room
	var ok bool
	if r, ok = rooms[roomID]; !ok {
		return errors.New("room does not exist")
	}
	r.echo = false
	// Number of attempts to make
	maxTries := 3
	tries := 1
	// Wait time for each try
	waitTime := 4000 * time.Millisecond
	success := make(chan struct{})
	r.setEventListener("promptReady", func() {
		close(success)
		r.removeEventListener("promptReady")
	})
loop:
	for {
		if r.container.runnerReaderActive {
			// Runner reader already active -- exit loop
			break loop
		}
		// Do not attempt language connection if room does not exist anymore
		if _, ok := rooms[roomID]; !ok {
			break loop
		}
		if err := attemptLangConn(lang, roomID); err != nil {
			switch err.(type) {
			case containerExecCreateError:
				// This is a fatal error for this open language
				// connection process -- stopped or inexistent
				// container -- so we break loop
				break loop
			case containerExecAttachError:
				// This is not a fatal error
			default:
				// Any other non-fatal errors, e.g., room not existing
			}
		}
		select {
		case <-success:
			// Turn reader restart on now since we know language
			// connection has been correctly established
			r.container.runnerReaderRestart = true
			r.echo = true
			resetTerminal(roomID)
			displayInitialPrompt(roomID, true, "1")
			return nil
		case <-time.After(waitTime):
			tries++
			if tries > maxTries {
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
		connection.Close()
	}
}

func attemptLangConn(lang, roomID string) error {
	var room *room
	var ok bool
	if room, ok = rooms[roomID]; !ok {
		return errors.New("room does not exist")
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
		// This error will be returned is container is not
		// running or non-existing;
		return containerExecCreateError{dockerErrMessage: err.Error()}
	}

	if room.replVersionInfo, err = getReplVersionInfo(lang, cn.ID); err != nil {
		logger.Println("Error getting repl version:", err)
	}

	cn.connection, err = cli.ContainerExecAttach(ctx,
		resp.ID, types.ExecStartCheck{})
	if err != nil {
		return containerExecAttachError{dockerErrMessage: err.Error()}
	}

	cn.execID = resp.ID
	cn.runner = cn.connection.Conn
	cn.bufReader = bufio.NewReader(cn.connection.Reader)
	// Set reader restart to false to prevent reader from
	// automatically trying to open the language connection if it
	// has not been established correctly
	cn.runnerReaderRestart = false
	startRunnerReader(roomID)
	return nil
}

func extractVersion(lang string, text []byte) ([]byte, error) {
	var re *regexp.Regexp
	var err error
	switch lang {
	case "ruby":
		re, err = regexp.Compile(`^ruby\s\d{1,3}\.\d{1,3}(?:\.\d{1,3})?`)
	case "node":
		re, err = regexp.Compile(`^v\d{1,3}\.\d{1,3}(?:\.\d{1,3})?`)
	case "postgres":
		re, err = regexp.Compile(`^psql\s\(PostgreSQL\)\s\d{1,3}\.\d{1,3}(?:\.\d{1,3})?`)
	}
	if err != nil {
		return nil, err
	}
	match := re.Find(text)
	if match == nil {
		return nil, errors.New("text does not contain version number")
	}
	return match, nil
}

func getReplVersionInfo(lang string, containerID string) (string, error) {
	var cmd []string
	switch lang {
	case "node":
		cmd = []string{"node", "-v"}
	case "postgres":
		cmd = []string{"psql", "--version"}
	case "ruby":
		cmd = []string{"ruby", "--version"}
	default:
		return "", nil
	}
	var output []byte
	var err error
	if output, err = executeSingleCmdInContainer(containerID, cmd); err != nil {
		return "", err
	}
	trimmedOutput := bytes.TrimSpace(output)
	versionInfo, err := extractVersion(lang, trimmedOutput)
	if err != nil {
		return "", err
	} else {
		return string(versionInfo), nil
	}
}

func executeSingleCmdInContainer(containerID string, cmd []string) ([]byte, error) {
	execOpts := types.ExecConfig{
		AttachStdout: true,
		AttachStderr: true,
		Cmd:          cmd,
	}

	resp, err := cli.ContainerExecCreate(context.Background(), containerID, execOpts)
	if err != nil {
		return nil, err
	}

	connection, err := cli.ContainerExecAttach(context.Background(),
		resp.ID, types.ExecStartCheck{})
	if err != nil {
		return nil, err
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
			return nil, err
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
			return nil, err
		}

		output = append(output, b...)
	}
	return output, nil
}

func getWelcomeMessage(roomID, lang string) []byte {
	var welcomeMessage []byte
	replVersionInfo := rooms[roomID].replVersionInfo
	switch lang {
	case "ruby":
		insertion := ""
		if replVersionInfo != "" {
			insertion = replVersionInfo + "\r\n"
		}
		welcomeMessage = []byte(insertion)
	case "node":
		insertion := ""
		if replVersionInfo != "" {
			insertion = " " + replVersionInfo
		}
		welcomeMessage = []byte(fmt.Sprintf("Welcome to Node.js%s.\r\nType \".help\" for more information.\r\n", insertion))
	case "postgres":
		insertion := "psql (PostgreSQL)\r\n"
		if replVersionInfo != "" {
			insertion = replVersionInfo + "\r\n"
		}
		welcomeMessage = []byte(fmt.Sprintf("%sType \"help\" for help.\r\n", insertion))
	}
	return welcomeMessage
}

func displayInitialPrompt(roomID string, welcome bool, promptNum string) {
	lang := rooms[roomID].lang
	var message, intro []byte
	switch lang {
	case "ruby":
		intro = getWelcomeMessage(roomID, "ruby")
		// Replace line number with correct line number (i.e., it's
		// not always 1, as in when we interrupt execution due to
		// timeout and then print prompt)
		message = bytes.Replace(initialPrompts["ruby"], []byte("1"), []byte(promptNum), 1)
	case "node":
		intro = getWelcomeMessage(roomID, "node")
		message = initialPrompts["node"]
	case "postgres":
		intro = getWelcomeMessage(roomID, "postgres")
		message = initialPrompts["postgres"]
	}
	if welcome {
		writeToWebsockets(intro, roomID)
	}
	writeToWebsockets(message, roomID)
}

// TODO: make this a room method?
func resetTerminal(roomID string) {
	writeToWebsockets([]byte("RESETTERMINAL"), roomID)
	// Also reset terminal history
	room := rooms[roomID]
	room.termHist = []byte("")
	if room.runTimeoutTimer != nil {
		room.runTimeoutTimer.Stop()
	}
	// if err := room.awaitSideEffect("promptReady", func() { deleteReplHistory(roomID) }, 2*time.Second, true); err != nil {
	// 	writeToWebsockets([]byte("TIMEOUT"), roomID)
	// }
	writeToWebsockets([]byte("CANCELRUN"), roomID)
}

func clientClearTerm(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		LastLine string `json:"lastLine"`
		RoomID   string `json:"roomID"`
	}
	var cm contentModel
	var body []byte
	var err error
	body, err = io.ReadAll(r.Body)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	rooms[cm.RoomID].termHist = []byte(cm.LastLine)

	sendJsonResponse(w, map[string]string{"status": "success"})
}

func sendJsonResponse(w http.ResponseWriter, data interface{}) {
	jsonResp, err := json.Marshal(data)
	if err != nil {
		// TODO: Pass this error back to caller
		logger.Println("err in marshaling: ", err)
	}
	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResp)
}

func doesRoomExist(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	queryValues := r.URL.Query()
	roomID := queryValues.Get("roomID")
	var exists bool
	if _, found := rooms[roomID]; found {
		exists = true
		// Record time of last check (Unix time in seconds)
		rooms[roomID].lastExistCheck = time.Now().Unix()
	} else {
		exists = false
	}
	sendJsonResponse(w, map[string]bool{"roomExists": exists})
}

func onlineCheckPing(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	w.Header().Set("Content-Type", "text/plain;charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(""))
}

func abortRun(roomID string) {
	// TODO: Use room.runTimeoutTimer field to stop this
	// procedure when resetting terminal
	room := rooms[roomID]
	cn := room.container
	room.echo = false
	// Send ctrl-c interrupt
	if err := room.awaitSideEffect("promptReady", func() { cn.runner.Write([]byte("\x03")) }, 2*time.Second, false); err != nil {
		writeToWebsockets([]byte("TIMEOUT"), roomID)
		return
	}
	if err := room.awaitSideEffect("promptReady", func() { deleteReplHistory(roomID) }, 2*time.Second, true); err != nil {
		writeToWebsockets([]byte("TIMEOUT"), roomID)
		return
	}
	writeToWebsockets([]byte("CANCELRUN"), roomID)
	writeToWebsockets([]byte("\r\nExecution interrupted because time limit exceeded.\r\n"), roomID)
	displayInitialPrompt(roomID, false, "3")
	room.echo = true
}

func runCode(roomID string, lang string, linesOfCode int, promptLineEmpty bool) error {
	room := rooms[roomID]
	cn := room.container
	// Max run time in seconds
	room.echo = false

	if !promptLineEmpty {
		cn.runner.Write([]byte("\x03")) // send ctrl-c
	}

	writeToWebsockets([]byte("\r\n\r\nRunning your code...\r\n"), roomID)
	switch lang {
	case "ruby":
		// reset repl
		if err := room.awaitSideEffect("promptReady", func() { cn.runner.Write([]byte("exec $0\n")) }, 3*time.Second, false); err != nil {
			writeToWebsockets([]byte("TIMEOUT"), roomID)
			return errors.New("Container Timeout")
		}
		// The following cmd depends on run_codeconnected_code method in ~/.pryrc
		// file on the runner server:
		err := room.awaitSideEffect("startOutput", func() {
			cn.runner.Write([]byte("run_codeconnected_code('code.rb');\n"))
		}, 3*time.Second, true)
		if err != nil {
			writeToWebsockets([]byte("TIMEOUT"), roomID)
			return errors.New("Container Timeout")
		}
	case "postgres":
		if err := room.awaitSideEffect("newline1", func() { cn.runner.Write([]byte("\\i code.sql\n")) }, 2*time.Second, true); err != nil {
			writeToWebsockets([]byte("TIMEOUT"), roomID)
			return errors.New("Container Timeout")
		}
	case "node":
		// Turn echo back on right before output begins
		// Account for output workaround (adding null; on newline at
		// end of file) in custom node launcher
		linesAddedInCustomNodeLauncher := 1
		extraLinesBeforeStdOutput := 2
		totalNewLinesBeforeStdOutput := linesOfCode + linesAddedInCustomNodeLauncher + extraLinesBeforeStdOutput
		// Add one to total lines to omit if prompt line is not
		// empty, since ctrl-c before run will add a line
		if !promptLineEmpty {
			totalNewLinesBeforeStdOutput += 1
		}
		err := room.awaitSideEffect("newline"+strconv.Itoa(totalNewLinesBeforeStdOutput),
			func() { cn.runner.Write([]byte(".runUserCode code.js\n")) }, 2*time.Second, true)
		if err != nil {
			writeToWebsockets([]byte("TIMEOUT"), roomID)
			return errors.New("Container Timeout")
		}
	}

	runFinishedChan := make(chan struct{})
	room.setEventListener("promptReady", func() {
		room.removeEventListener("promptReady")
		close(runFinishedChan)
	})
	room.runTimeoutTimer = time.NewTimer(maxRunTime)
	select {
	case <-room.runTimeoutTimer.C:
		abortRun(roomID)
		return errors.New("Container or run timeout")
	case <-room.abortRunChan:
		return errors.New("Container or run timeout")
	case <-runFinishedChan:
		room.runTimeoutTimer.Stop()
	}

	if err := room.awaitSideEffect("promptReady", func() { deleteReplHistory(roomID) }, 2*time.Second, true); err != nil {
		writeToWebsockets([]byte("TIMEOUT"), roomID)
		return errors.New("Container Timeout")
	}
	writeToWebsockets([]byte("RUNDONE"), roomID)
	return nil
}

func deleteReplHistory(roomID string) {
	room := rooms[roomID]
	cn := room.container
	var cmd string

	switch room.lang {
	case "ruby":
		cmd = "clear_history;\n"
	case "node":
		cmd = ".deleteHistory\n"
	case "postgres":
		// Do nothing for postgres, but send newline so promptReady
		// event fires
		cmd = "\n"
	}

	cn.runner.Write([]byte(cmd))
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	if err := runCode(pm.RoomID, pm.Lang, pm.Lines, pm.PromptLineEmpty); err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	sendJsonResponse(w, map[string]string{"status": "success"})
}

func updateCodeSession(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type paramsModel struct {
		CodeSessionID int
		Language      string
		Content       string
		TimeOnly      bool
	}
	var pm paramsModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &pm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	// Do not save sessions with excessively long content
	if len(pm.Content) > 64000 {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		logger.Printf("Session %d is excessively long. Will not save.", pm.CodeSessionID)
		return
	}

	if err = runSessionUpdateQuery(pm.CodeSessionID, pm.Language, pm.Content, pm.TimeOnly); err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	sendJsonResponse(w, map[string]string{"status": "success"})
}

func runSessionUpdateQuery(codeSessionID int, language string, content string, timeOnly bool) error {
	var err error
	currentTime := time.Now().Unix()
	if timeOnly {
		query := `UPDATE coding_sessions SET when_accessed = $1 WHERE id = $2`
		_, err = pool.Exec(context.Background(), query, currentTime, codeSessionID)
	} else {
		query := `UPDATE coding_sessions SET when_accessed = $1, lang = $2, editor_contents = $3 WHERE id = $4`
		_, err = pool.Exec(context.Background(), query, currentTime, language, content, codeSessionID)
	}
	return err
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
		// Check if room container exists to make sure we're not
		// deleting rooms that are in the process of being created
		// Also check time since last "does room exist check"; if
		// there was a recent check, we don't want to delete the room
		// since a user may be about to join
		timeSinceLastExistsCheck := time.Now().Unix() - room.lastExistCheck
		if len(room.wsockets) == 0 && room.status == "open" && timeSinceLastExistsCheck > 10 {
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
	container := room.container
	// Remove empty room from rooms map We have to delete the room
	// from the rooms map first, before removing container, because
	// container removal procedure can cause delay
	delete(rooms, roomID)
	// Update room access time if code session associated with it
	if room.codeSessionID != -1 {
		updateRoomAccessTime(room.codeSessionID)
	}
	abortContainer(container)
}

func abortContainer(container *containerDetails) {
	// Set the restart flag to false so that the reader
	// doesn't automatically restart when we close the connection
	container.runnerReaderRestart = false
	// Close hijacked connection with runner
	closeContainerConnection(container.connection)
	// Remove room container
	err := stopAndRemoveContainer(container.ID)
	if err != nil {
		logger.Println("error in stopping/removing container: ", err)
	}
}

// Remove empty rooms at an interval
func startRoomCloser() {
	const checkInterval = 60 // Time between checks in seconds
	go func() {
		for {
			time.Sleep(checkInterval * time.Second)
			closeEmptyRooms()
		}
	}()
}

// Removed orphaned containers (containers that are not used by
// any rooms) at an interval
func startOrphanedContainerCloser() {
	const checkInterval = 120 // Time between checks in seconds
	go func() {
		for {
			time.Sleep(checkInterval * time.Second)
			closeOrphanedContainers()
		}
	}()
}

func closeOrphanedContainers() {
	// Get list of containers
	containers, err := cli.ContainerList(context.Background(), types.ContainerListOptions{})
	if err != nil {
		return
	}

	var orphanIDs []string
	for _, container := range containers {
		orphanIDs = append(orphanIDs, container.ID)
	}

	for i := 0; i < 3; i++ {
		// Iterate over rooms and remove containers in use from orphan list
		for _, room := range rooms {
			if i := indexOf(orphanIDs, room.container.ID); i != -1 {
				orphanIDs = append(orphanIDs[:i], orphanIDs[i+1:]...)
			}
		}

		// Pause to allow any containers in the process of being
		// assigned to rooms to be assigned
		time.Sleep(2 * time.Second)
	}

	// Remove orphans
	for _, orphanID := range orphanIDs {
		if err := stopAndRemoveContainer(orphanID); err != nil {
			logger.Println("error in stopping/removing container: ", err)
		}
	}
}

func indexOf(list []string, queryItem string) int {
	for i, e := range list {
		if e == queryItem {
			return i
		}
	}
	return -1
}

func stopAndRemoveContainer(containername string) error {
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
	startOrphanedContainerCloser()
	store.Options = &sessions.Options{
		SameSite: http.SameSiteStrictMode,
	}
	router := httprouter.New()
	router.POST("/api/save-content", saveContent)
	router.GET("/api/open-ws", openWs)
	router.POST("/api/create-room", createRoom)
	router.POST("/api/prepare-room", prepareRoom)
	router.POST("/api/activate-user", activateUser)
	router.GET("/api/does-room-exist", doesRoomExist)
	router.GET("/api/online-check-ping", onlineCheckPing)
	router.GET("/api/get-initial-room-data", getInitialRoomData)
	router.GET("/api/get-room-status", getRoomStatus)
	router.GET("/api/get-user-info", getUserInfo)
	router.POST("/api/switch-language", switchLanguage)
	router.POST("/api/run-file", runFile)
	router.POST("/api/sign-up", signUp)
	router.POST("/api/sign-in", signIn)
	router.POST("/api/sign-out", signOut)
	router.POST("/api/resend-verification-email", resendVerificationEmail)
	router.POST("/api/forgot-password", forgotPassword)
	router.POST("/api/reset-password", resetPassword)
	router.POST("/api/client-clear-term", clientClearTerm)
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

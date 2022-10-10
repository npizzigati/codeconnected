package main

import (
	"context"
	"encoding/json"
	"github.com/julienschmidt/httprouter"
	"golang.org/x/crypto/bcrypt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"
)

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
	session, err := getSessStore().Get(r, "session")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type contentModel struct {
		Email       string `json:"email"`
		PlainTextPW string `json:"plainTextPW"`
	}
	var cm contentModel
	var body []byte
	body, err = io.ReadAll(r.Body)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure", "reason": "Error processing sign-in request"})
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure", "reason": "Error processing sign-in request"})
		return
	}
	pepperedPW := cm.PlainTextPW + os.Getenv("PWPEPPER")
	emailFound := true
	signedIn := false
	var encryptedPW, username string
	var userID int
	query := "SELECT encrypted_pw, username, id FROM users WHERE email = $1"
	if err := getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&encryptedPW, &username, &userID); err != nil {
		// Error will throw if no records found
		emailFound = false
	}

	if emailFound && bcrypt.CompareHashAndPassword([]byte(encryptedPW), []byte(pepperedPW)) == nil {
		// successful sign in
		signedIn = true
		session.Values["auth"] = true
		session.Values["email"] = cm.Email
		session.Values["username"] = username
		session.Values["userID"] = userID
		if err = session.Save(r, w); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if signedIn {
		sendJsonResponse(w, map[string]string{"status": "success"})
	} else {
		time.Sleep(2 * time.Second)
		sendJsonResponse(w, map[string]string{"status": "failure", "reason": "Username and/or password incorrect"})
	}
}

func getUserInfo(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := getSessStore().Get(r, "session")
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
		sendJsonResponse(w, response)
		return
	}

	var (
		email, username string
		ok              bool
	)
	if email, ok = session.Values["email"].(string); !ok {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
	if username, ok = session.Values["username"].(string); !ok {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	err = session.Save(r, w)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := &responseModel{
		Auth:     true,
		Email:    email,
		Username: username,
	}

	sendJsonResponse(w, response)
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	// Determine whether email is in database
	query := "SELECT id FROM users WHERE email = $1"
	emailFound := true
	var userID int
	if err := getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&userID); err != nil {
		emailFound = false
	}

	if !emailFound {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	// Delete any existing password reset requests for user
	deleteRequestRec(userID)

	// Enter code and expiry into password reset requests
	expiry := time.Now().Add(resetTimeout * time.Minute).Unix()
	code := generateRandomCode()
	query = "INSERT INTO password_reset_requests(user_id, reset_code, expiry, code_attempts) VALUES($1, $2, $3, $4)"
	if _, err := getDBPool().Exec(context.Background(), query, userID, code, expiry, 0); err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
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

	if err := sendPasswordResetEmail(cm.Email, code); err != nil {
		logger.Println("Error in sending password reset email:", err)
		sendJsonResponse(w, map[string]string{"status": "failure"})
	}
	sendJsonResponse(w, map[string]string{"status": "success"})
}

func generateRandomCode() string {
	max := 999999
	min := 100000
	rand.Seed(time.Now().UnixNano())
	return strconv.Itoa(rand.Intn(max-min) + min)
}

func updateResetCodeAttempts(email string) {
	query := "UPDATE password_reset_requests p SET code_attempts = code_attempts + 1 FROM users u WHERE u.id = p.user_id AND email = $1"
	if _, err := getDBPool().Exec(context.Background(), query, email); err != nil {
		logger.Println("Unable to update code_attempts: ", err)
	}
}

func updateActivationCodeAttempts(email string) {
	query := "UPDATE pending_activations SET code_attempts = code_attempts + 1 WHERE email = $1"
	if _, err := getDBPool().Exec(context.Background(), query, email); err != nil {
		logger.Println("Unable to update code_attempts: ", err)
	}
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
		sendJsonResponse(w, map[string]string{"status": "failure", "message": "Something went wrong — please try again"})
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure", "message": "Something went wrong — please try again"})
		return
	}

	query := "SELECT p.user_id, p.expiry, p.code_attempts, p.reset_code FROM password_reset_requests AS p INNER JOIN users AS u ON p.user_id = u.id WHERE u.email = $1"
	var resetCode string
	var userID, codeAttempts int
	var expiry int64
	if err := getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&userID, &expiry, &codeAttempts, &resetCode); err != nil {
		time.Sleep(2 * time.Second)
		sendJsonResponse(w, map[string]string{"status": "failure", "message": "Reset code expired"})
		return
	}

	if cm.Code != resetCode {
		updateResetCodeAttempts(cm.Email)
		time.Sleep(2 * time.Second)
		if codeAttempts > 2 {
			deleteRequestRec(userID)
			sendJsonResponse(w, map[string]string{"status": "failure", "message": "Reset attempts exceeded"})
			return
		}
		sendJsonResponse(w, map[string]string{"status": "failure", "message": "Incorrect reset code"})
		return
	}

	// Generate encrypted password
	pepperedPW := cm.NewPlaintextPW + os.Getenv("PWPEPPER")
	encryptedPW, err := bcrypt.GenerateFromPassword([]byte(pepperedPW),
		bcrypt.DefaultCost)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure", "message": "Something went wrong -- please try again"})
		return
	}

	// Change password in db
	query = "UPDATE users SET encrypted_pw = $1 WHERE id = $2"
	if _, err := getDBPool().Exec(context.Background(), query, encryptedPW, userID); err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure", "message": "Something went wrong -- please try again"})
		return
	}
	deleteRequestRec(userID)
	sendJsonResponse(w, map[string]string{"status": "success"})
}

func deleteRequestRec(userID int) error {
	query := "DELETE FROM password_reset_requests WHERE user_id = $1"
	if _, err := getDBPool().Exec(context.Background(), query, userID); err != nil {
		return err
	}
	return nil
}

func deleteActivationRec(email string) error {
	query := "DELETE FROM pending_activations WHERE email = $1"
	if _, err := getDBPool().Exec(context.Background(), query, email); err != nil {
		return err
	}
	return nil
}

func activateUser(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	session, err := getSessStore().Get(r, "session")
	type contentModel struct {
		Code  string `json:"code"`
		Email string `json:"email"`
	}
	type responseModel struct {
		Status  string `json:"status"`
		IsFatal bool   `json:"isFatal"`
		Message string `json:"message"`
	}
	fatalFailureRes := &responseModel{
		Status:  "failure",
		IsFatal: true,
	}
	nonFatalFailureRes := &responseModel{
		Status:  "failure",
		IsFatal: false,
	}
	successRes := &responseModel{
		Status:  "success",
		IsFatal: false,
	}
	var cm contentModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		nonFatalFailureRes.Message = "Something went wrong — please try again"
		sendJsonResponse(w, nonFatalFailureRes)
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		nonFatalFailureRes.Message = "Something went wrong — please try again"
		sendJsonResponse(w, nonFatalFailureRes)
		return
	}

	query := "SELECT username, encrypted_pw, expiry, code_attempts, activation_code FROM pending_activations WHERE email = $1"
	var codeAttempts int
	var username, encryptedPW, activationCode string
	var expiry int64
	if err = getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&username, &encryptedPW, &expiry, &codeAttempts, &activationCode); err != nil {
		// Will throw error if no record found (i.e., activation
		// request expired and deleted)
		fatalFailureRes.Message = "Your activation code has expired."
		sendJsonResponse(w, fatalFailureRes)
		return
	}
	if cm.Code != activationCode {
		updateActivationCodeAttempts(cm.Email)
		if codeAttempts > 2 {
			fatalFailureRes.Message = "Activation attempts exceeded."
			deleteActivationRec(cm.Email)
			sendJsonResponse(w, fatalFailureRes)
			return
		}
		nonFatalFailureRes.Message = "Activation code incorrect"
		// Pause briefly after wrong code entered to impede attacks
		time.Sleep(2 * time.Second)
		sendJsonResponse(w, nonFatalFailureRes)
		return
	}

	userID := -1
	deleteActivationRec(cm.Email)
	query = "INSERT INTO users(username, email, encrypted_pw) VALUES($1, $2, $3) RETURNING id;"
	if err := getDBPool().QueryRow(context.Background(), query, username, cm.Email, encryptedPW).Scan(&userID); err != nil {
		fatalFailureRes.Message = "There was a problem creating your account."
		sendJsonResponse(w, fatalFailureRes)
		return
	}

	if userID == -1 {
		fatalFailureRes.Message = "There was a problem creating your account."
		sendJsonResponse(w, fatalFailureRes)
		return
	}

	session.Values["auth"] = true
	session.Values["email"] = cm.Email
	session.Values["username"] = username
	session.Values["userID"] = userID
	if err = session.Save(r, w); err != nil {
		fatalFailureRes.Message = "Your account was created but we were unable to sign you in. Please return to the sign-in form to sign in."
		sendJsonResponse(w, fatalFailureRes)
		return
	}

	sendJsonResponse(w, successRes)
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
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}
	pepperedPW := cm.PlainTextPW + os.Getenv("PWPEPPER")
	encryptedPW, err := bcrypt.GenerateFromPassword([]byte(pepperedPW),
		bcrypt.DefaultCost)
	if err != nil {
		sendJsonResponse(w, map[string]string{"status": "failure"})
		return
	}

	expiry := time.Now().Add(activationTimeout).Unix()
	code := generateRandomCode()

	// Check whether user has already registered
	var emailUsed bool
	query := "SELECT 1 FROM users WHERE email = $1"
	var tmp int
	if err := getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&tmp); err == nil {
		// Will throw error if no records found
		emailUsed = true
	} else {
		query = "SELECT 1 FROM pending_activations WHERE email = $1"
		var tmp int
		if err := getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&tmp); err == nil {
			// Will throw error if no records found
			emailUsed = true
		}
	}

	if !emailUsed {
		query = "INSERT INTO pending_activations(username, email, encrypted_pw, activation_code, expiry, code_resends, code_attempts) VALUES($1, $2, $3, $4, $5, $6, $7)"
		if _, err := getDBPool().Exec(context.Background(), query, cm.Username, cm.Email, encryptedPW, code, expiry, 0, 0); err != nil {
			sendJsonResponse(w, map[string]string{"status": "failure"})
			return
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

		sendVerificationEmail(cm.Username, cm.Email, code)
	}

	type responseModel struct {
		EmailUsed bool   `json:"emailUsed"`
		Status    string `json:"status"`
	}
	response := &responseModel{
		EmailUsed: emailUsed,
		Status:    "success",
	}

	sendJsonResponse(w, response)
}

func resendVerificationEmail(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	type contentModel struct {
		Email    string `json:"email"`
		Username string `json:"username"`
	}
	type responseModel struct {
		Status  string `json:"status"`
		IsFatal bool   `json:"isFatal"`
		Message string `json:"message"`
	}
	fatalFailureRes := &responseModel{
		Status:  "failure",
		IsFatal: true,
	}
	nonFatalFailureRes := &responseModel{
		Status:  "failure",
		IsFatal: false,
	}
	successRes := &responseModel{
		Status:  "success",
		IsFatal: false,
	}
	var cm contentModel
	body, err := io.ReadAll(r.Body)
	if err != nil {
		nonFatalFailureRes.Message = "Something went wrong — please try again"
		sendJsonResponse(w, nonFatalFailureRes)
		return
	}
	err = json.Unmarshal(body, &cm)
	if err != nil {
		nonFatalFailureRes.Message = "Something went wrong — please try again"
		sendJsonResponse(w, nonFatalFailureRes)
		return
	}

	var codeResends int
	query := "SELECT code_resends FROM pending_activations WHERE email = $1"
	if err := getDBPool().QueryRow(context.Background(), query, cm.Email).Scan(&codeResends); err != nil {
		// Will throw error if no record found (i.e., activation
		// request expired and deleted)
		fatalFailureRes.Message = "Activation request has expired."
		sendJsonResponse(w, fatalFailureRes)
		return
	}
	if codeResends > 2 {
		fatalFailureRes.Message = "Code resent maximum number of times"
		sendJsonResponse(w, fatalFailureRes)
		return
	}

	// Update fields
	activationCode := generateRandomCode()
	expiry := time.Now().Add(activationTimeout).Unix()
	query = "UPDATE pending_activations SET activation_code = $1, expiry = $2, code_resends = $3, code_attempts = $4 WHERE email = $5"
	if _, err := getDBPool().Exec(context.Background(), query, activationCode, expiry, codeResends+1, 0, cm.Email); err != nil {
		fatalFailureRes.Message = "Something went wrong — please try again in 10 minutes."
		sendJsonResponse(w, fatalFailureRes)
		return
	}

	if err := sendVerificationEmail(cm.Username, cm.Email, activationCode); err != nil {
		fatalFailureRes.Message = "Something went wrong — please try again in 10 minutes."
		sendJsonResponse(w, fatalFailureRes)
		return
	}
	sendJsonResponse(w, successRes)
}

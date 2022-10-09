package main

import (
	"context"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sesTypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

var sesCli *sesv2.Client

func initSesClient() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		logger.Println("error in loading AWS SES config: ", err)
	}
	sesCli = sesv2.NewFromConfig(cfg)
}

func sendPasswordResetEmail(emailAddr, resetCode string) error {
	subject := "Your password reset code"
	body := buildPasswordResetEmailBody(resetCode)
	if err := sendEmail(emailAddr, subject, body); err != nil {
		return err
	}
	return nil
}

func sendVerificationEmail(username, emailAddr, activationCode string) error {
	subject := "Verify your email address"
	body := buildVerificationEmailBody(username, activationCode)
	if err := sendEmail(emailAddr, subject, body); err != nil {
		return err
	}
	return nil
}

func sendEmail(emailAddr, subject, body string) error {
	fromAddr := "codeconnected <contact@codeconnected.dev>"
	destAddr := sesTypes.Destination{
		ToAddresses: []string{emailAddr},
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
	_, err := sesCli.SendEmail(context.Background(), &email)
	if err != nil {
		return err
	}
	return nil
}

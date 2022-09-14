package main

import (
	"fmt"
)

// Templates
const verificationEmailTemplate = `Hi %s!

Your verification code is %s.

Enter it in the codeconnected sign-up dialog to complete your registration.

If you have any questions, or if you don't know why you received this, please reply to this email.

Thanks!
The codeconnected team`

const passwordResetEmailTemplate = `Hi!

Your password reset code is %s.

Enter it in the codeconnected password reset dialog to complete the reset process.

If you have any questions, or if you don't know why you received this, please reply to this email.

Thanks!
The codeconnected team`

// Builders
func buildVerificationEmailBody(username, activationCode string) string {
	return fmt.Sprintf(verificationEmailTemplate, username, activationCode)
}

func buildPasswordResetEmailBody(resetCode string) string {
	return fmt.Sprintf(passwordResetEmailTemplate, resetCode)
}

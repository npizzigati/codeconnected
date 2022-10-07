package main

import (
	"fmt"
)

// Templates
const verificationEmailTemplate = `Hi %s!

Your verification code is %s.

Enter it in the codeconnected sign-up dialog to complete your registration.

If you have any questions, please reply to this email.

Thanks!
The codeconnected team

Note: This email was sent as part of an automated sign-up process. If you were not expecting it, you can safely ignore it. No account will be created using this email without your consent.`

const passwordResetEmailTemplate = `Hi!

Your password reset code is %s.

Enter it in the codeconnected password reset dialog to complete the reset process.

If you have any questions, please reply to this email.

Thanks!
The codeconnected team`

// Builders
func buildVerificationEmailBody(username, activationCode string) string {
	return fmt.Sprintf(verificationEmailTemplate, username, activationCode)
}

func buildPasswordResetEmailBody(resetCode string) string {
	return fmt.Sprintf(passwordResetEmailTemplate, resetCode)
}

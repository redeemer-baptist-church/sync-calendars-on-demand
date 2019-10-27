// TODO: only load this in dev; not in test, not in prod
require('dotenv').config() // load gcloud credentials in dev

const {Secret} = require('@redeemerbc/secret')

const {GoogleSheetsToGoogleCalendarSync} = require('./GoogleSheetsToGoogleCalendarSync')
const {MailchimpToGsuiteMembershipSync} = require('./MailchimpToGsuiteMembershipSync')
const {MailchimpNewsletterGenerator} = require('./MailchimpNewsletterGenerator')

// TODO: TypeScript, and nuke ow

// TODO: break out mailchimp_to_gsuite_membership_sync cloud function
// Convert this package to `newsletter` instead of `mailchimp`
// Create a config approach for template IDs, calendar order, etc.

class App {
  async run() {
    this.gsuiteServiceAccount = await new Secret('GsuiteServiceAccount').get()
    this.mailchimpApiKey = await new Secret('MailchimpApiKey').get()

    await new MailchimpToGsuiteMembershipSync(this.gsuiteServiceAccount, this.mailchimpApiKey).run()
    await new MailchimpNewsletterGenerator(this.gsuiteServiceAccount, this.mailchimpApiKey).run()
    await new GoogleSheetsToGoogleCalendarSync(this.gsuiteServiceAccount).run()
  }
}

new App().run()
  .catch((e) => {
    console.log(e)
    throw e
  })

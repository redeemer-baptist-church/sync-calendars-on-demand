// TODO: only load this in dev; not in test, not in prod
require('dotenv').config() // load gcloud credentials in dev

const {Mailchimp} = require('./lib/mailchimp')
const {Secret} = require('./lib/secret')

async function run() {
  const apiKey = await new Secret('MailchimpApiKey').get()

  const mailchimp = new Mailchimp(apiKey)
  mailchimp.members.reduce((tagGroups, member) => {
    member.tags.forEach((tag) => {
      const tagName = tag.name
      const group = tagGroups[tagName] || []
      group.push(member.email)
      tagGroups[tagName] = group // eslint-disable-line no-param-reassign
    })
    return tagGroups
  }, {}).then(tagGroups => console.log(tagGroups))
}
run()

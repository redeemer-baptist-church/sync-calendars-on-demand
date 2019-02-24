// TODO: only load this in dev; not in test, not in prod
require('dotenv').config() // load gcloud credentials in dev

const pluralize = require('pluralize')
const {Mailchimp} = require('./lib/mailchimp')
const {Secret} = require('./lib/secret')
const {
  Client: GSuiteClient,
  GroupManager: GSuiteGroupManager,
} = require('./lib/@gsuite')

// TODO:
// * Write code to create a group for every Mailchimp tag
//   * Check to see if the group exists - DONE
//   * If not, create it - DONE
//   * Group will need to allow non-domain member
//   * Group should not accept emails from non-group-members
// * For every Mailchimp user with that tag,
//   * Add them to the group
//     * Identify them by both name and email address
//   * Remove any current group users who do not have the tag
//
// * For each calendar, create a separate GCP Function that knows how to populate it
//   * Make sure the members group has read access
//   * Only the service account should have write access
// * For each calandar, manually create a Google Form that takes in required inputs,
//     and knows how to populate the calendar
//
// With the completed calendars, scrape them for a given Sunday and generate a newsletter template

async function getMailchimpTagGroups() {
  const apiKey = await new Secret('MailchimpApiKey').get()

  const mailchimp = new Mailchimp(apiKey)
  return mailchimp.members.reduce((tagGroups, member) => {
    member.tags.forEach((tag) => {
      const tagName = tag.name
      const group = tagGroups[tagName] || []
      group.push(member.email)
      tagGroups[tagName] = group // eslint-disable-line no-param-reassign
    })
    return tagGroups
  }, {})
}

async function buildGsuiteConnection() {
  const serviceAccount = await new Secret('GsuiteServiceAccount').get()
  const scopes = [
    'https://www.googleapis.com/auth/admin.directory.group', // admin access to create/update groups of users
    'https://www.googleapis.com/auth/admin.directory.resource.calendar', // admin access to create/update calendars
    'https://www.googleapis.com/auth/admin.directory.user.readonly', // readonly access to list all users XXX: do I actually need this?
  ]
  const client = new GSuiteClient(scopes, serviceAccount)
  return client.buildConnection('directory_v1')
}

async function syncGroups() {
  const mailchimpGroups = await getMailchimpTagGroups()
    .then(groups => Object.keys(groups).map(group => pluralize.plural(group)))
  console.info('Mailchimp reports these groups:', mailchimpGroups)

  const connection = await buildGsuiteConnection()
  const manager = new GSuiteGroupManager({connection, domain: 'redeemerbc.com'})

  const gsuiteGroups = await manager.getGroups().then(groups => groups.map(group => group.name))
  console.info('GSuite reports these groups:', gsuiteGroups)

  const groupsToCreate = mailchimpGroups.filter(g => !gsuiteGroups.includes(g))
  console.info('These groups exist in Mailchimp but not in GSuite:', groupsToCreate)
  await manager.createGroups(groupsToCreate)

  const groupsToDelete = gsuiteGroups.filter(g => !mailchimpGroups.includes(g))
  console.info('These groups exist in GSuite but not in Mailchimp:', groupsToDelete)
  await manager.deleteGroups(groupsToDelete)
}

async function run() {
  await syncGroups()
}
run().catch(e => console.log(e))

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
// * For each calendar, create a separate GCP Function that knows how to populate it
//   * Make sure the members group has read access
//   * Only the service account should have write access
// * For each calandar, manually create a Google Form that takes in required inputs,
//     and knows how to populate the calendar
//
// With the completed calendars, scrape them for a given Sunday and generate a newsletter template

async function getMailchimpGroupedUsers() {
  const apiKey = await new Secret('MailchimpApiKey').get()

  const mailchimp = new Mailchimp(apiKey)
  return mailchimp.members.reduce((tagGroups, member) => {
    member.tags.forEach((tag) => {
      const tagName = pluralize.plural(tag.name)
      const group = tagGroups[tagName] || []
      group.push({
        email: member.email,
        name: member.name,
      })
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

async function syncGroupsFromMailchimpToGoogle(manager, mailchimpGroups) {
  console.info('Synching these Mailchimp groups to GSuite:', mailchimpGroups)

  const gsuiteGroups = await manager.getGroups().then(groups => groups.map(group => group.name.toLowerCase()))
  console.info('GSuite reports these groups:', gsuiteGroups)

  const groupsToCreate = mailchimpGroups.filter(g => !gsuiteGroups.includes(g))
  console.info('These groups exist in Mailchimp but not in GSuite:', groupsToCreate)
  await manager.createGroups(groupsToCreate)

  const groupsToDelete = gsuiteGroups.filter(g => !mailchimpGroups.includes(g))
  console.info('These groups exist in GSuite but not in Mailchimp:', groupsToDelete)
  await manager.deleteGroups(groupsToDelete)
}

async function syncUsersFromMailchimpIntoGoogleGroups(manager, mailchimpGroupedUsers) {
  Object.entries(mailchimpGroupedUsers).forEach(async ([group, groupedUsers]) => {
    const mailchimpUsers = groupedUsers.map(user => user.email.toLowerCase())
    console.info(`Synching these Mailchimp users to GSuite group '${group}':`, mailchimpUsers)

    const gsuiteUsers = await manager.getUsers(group).then(users => users.map(user => user.email.toLowerCase()))
    console.info('GSuite reports these users:', gsuiteUsers)

    const usersToCreate = mailchimpUsers.filter(u => !gsuiteUsers.includes(u))
    console.info(`These users exist in Mailchimp but not in GSuite group ${group}:`, usersToCreate)
    await manager.insertUsers(usersToCreate, group)

    const usersToDelete = gsuiteUsers.filter(u => !mailchimpUsers.includes(u))
    console.info(`These users exist in GSuite but not in Mailchimp group ${group}:`, usersToDelete)
    await manager.deleteUsers(usersToDelete, group)
  })
}

async function run() {
  const connection = await buildGsuiteConnection()
  const manager = new GSuiteGroupManager({connection, domain: 'redeemerbc.com'})

  const mailchimpGroupedUsers = await getMailchimpGroupedUsers()
  console.log(mailchimpGroupedUsers)
  const mailchimpGroups = Object.keys(mailchimpGroupedUsers).map(group => group.toLowerCase())
  console.info('Mailchimp reports these groups:', mailchimpGroups)
  await syncGroupsFromMailchimpToGoogle(manager, mailchimpGroups)
  await syncUsersFromMailchimpIntoGoogleGroups(manager, mailchimpGroupedUsers)
}
run().catch(e => console.log(e))

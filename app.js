// TODO: only load this in dev; not in test, not in prod
require('dotenv').config() // load gcloud credentials in dev

const uniqBy = require('lodash/uniqBy')
const cheerio = require('cheerio')
const dayjs = require('dayjs')
const pluralize = require('pluralize')
const unirest = require('unirest')
const SpotifyWebApi = require('spotify-web-api-node')

const {
  Client: GSuiteClient,
  CalendarManager: GSuiteCalendarManager,
  GroupManager: GSuiteGroupManager,
  PeopleManager: GSuitePeopleManager,
} = require('@redeemerbc/gsuite')
const {Secret} = require('@redeemerbc/secret')
const {Mailchimp} = require('./lib/mailchimp')

// TODO:
// * For each calendar, create a separate GCP Function that knows how to populate it
//   * Make sure the members group has read access
//   * Only the service account should have write access
// * For each calandar, manually create a Google Form that takes in required inputs,
//     and knows how to populate the calendar
//
// With the completed calendars, scrape them for a given Sunday and generate a newsletter template

// TODO: calendar scheduling UI
// * Create a calendar for each position - CM Littles, CM Kids, Setup Truck, etc
// * Associate eligible members with each calendar
// * Create an "Unavailable" calendar with all-day events to capture times when folks are out of town
// * Provide an interface for editng calendar entries
// * Support auto-filling the schedule

// TODO: break out mailchimp_to_gsuite_membership_sync cloud function
// Convert this package to `newsletter` instead of `mailchimp`
// Create a config approach for template IDs, calendar order, etc.

class MailchimpToGsuiteMembershipSync {
  constructor(gsuiteServiceAccount, mailchimpApiKey) {
    this.gsuiteServiceAccount = gsuiteServiceAccount
    this.mailchimpApiKey = mailchimpApiKey
  }

  async run() {
    this.mailchimpGroupedUsers = await this.getMailchimpGroupedUsers()

    await this.syncGroupsFromMailchimpToGoogle()
    await this.syncUsersFromMailchimpIntoGoogleGroups()

    await this.syncUsersFromMailchimpIntoGoogleContacts()
  }

  async getMailchimpGroupedUsers() { // eslint-disable-line class-methods-use-this
    const mailchimp = new Mailchimp(this.mailchimpApiKey)
    return mailchimp.members.reduce((tagGroups, member) => {
      member.tags.forEach((tag) => {
        const tagName = pluralize.plural(tag.name)
        const group = tagGroups[tagName] || []
        group.push({
          email: member.email,
          name: member.name,
          firstName: member.firstName,
          lastName: member.lastName,
        })
        tagGroups[tagName] = group // eslint-disable-line no-param-reassign
      })
      return tagGroups
    }, {})
  }

  async buildGsuiteAdminConnection() {
    const scopes = [
      'https://www.googleapis.com/auth/admin.directory.group', // admin access to create/update groups of users
      'https://www.googleapis.com/auth/admin.directory.resource.calendar', // admin access to create/update calendars
      'https://www.googleapis.com/auth/admin.directory.user.readonly', // readonly access to list all users XXX: do I actually need this?
    ]
    const client = new GSuiteClient(scopes, this.gsuiteServiceAccount)
    return client.buildConnection('admin', 'directory_v1')
  }

  async buildGsuiteGroupManager() {
    const connection = await this.buildGsuiteAdminConnection()
    return new GSuiteGroupManager({connection, domain: 'redeemerbc.com'})
  }

  async syncGroupsFromMailchimpToGoogle() {
    const mailchimpGroups = Object.keys(this.mailchimpGroupedUsers).map(group => group.toLowerCase())

    console.info('Synching these Mailchimp groups to GSuite:', mailchimpGroups)
    const manager = await this.buildGsuiteGroupManager()

    const gsuiteGroups = await manager.getGroups().then(groups => groups.map(group => group.name.toLowerCase()))
    console.info('GSuite reports these groups:', gsuiteGroups)

    const groupsToCreate = mailchimpGroups.filter(g => !gsuiteGroups.includes(g))
    console.info('These groups exist in Mailchimp but not in GSuite:', groupsToCreate)
    await manager.createGroups(groupsToCreate)

    const groupsToDelete = gsuiteGroups.filter(g => !mailchimpGroups.includes(g))
    console.info('These groups exist in GSuite but not in Mailchimp:', groupsToDelete)
    await manager.deleteGroups(groupsToDelete)
  }

  async syncUsersFromMailchimpIntoGoogleGroups() {
    const manager = await this.buildGsuiteGroupManager()
    Object.entries(this.mailchimpGroupedUsers).forEach(async ([group, groupedUsers]) => {
      const mailchimpUsers = groupedUsers.map(user => user.email.toLowerCase()).sort()
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

  async buildGsuitePeopleConnection() {
    const scopes = [
      'https://www.googleapis.com/auth/contacts', // read/write acccess to contact lists
    ]
    const client = new GSuiteClient(scopes, this.gsuiteServiceAccount)
    return client.buildConnection('people', 'v1')
  }

  async buildGsuitePeopleManager() {
    const connection = await this.buildGsuitePeopleConnection()
    return new GSuitePeopleManager({connection})
  }

  async syncUsersFromMailchimpIntoGoogleContacts() {
    const mailchimpUsers = uniqBy(Object.values(this.mailchimpGroupedUsers).flat(), 'email')
    const mailchimpUserEmails = mailchimpUsers.map(user => user.email.toLowerCase()).sort()
    console.info('Synching these Mailchimp users to GSuite contacts:', mailchimpUserEmails)

    const manager = await this.buildGsuitePeopleManager()
    const gsuiteContacts = await manager.getContacts({
      personFields: 'names,emailAddresses',
    })
    const gsuiteContactEmails = gsuiteContacts.map(user => user.email.toLowerCase()).sort()
    console.info('GSuite reports these users:', gsuiteContactEmails)

    const usersToCreate = mailchimpUsers.filter(u => !gsuiteContactEmails.includes(u.email.toLowerCase()))
    console.info('These users exist in Mailchimp but not in GSuite contacts:', usersToCreate)
    await manager.createContacts(usersToCreate)

    const usersToDelete = gsuiteContacts.filter(u => !mailchimpUserEmails.includes(u.email.toLowerCase()))
    console.info('These users exist in GSuite but not in Mailchimp contacts:', usersToDelete)
    await manager.deleteContacts(usersToDelete.map(user => user.resourceName))
  }
}

class MailchimpNewsletterGenerator {
  constructor(gsuiteServiceAccount, mailchimpApiKey) {
    this.gsuiteServiceAccount = gsuiteServiceAccount
    this.mailchimpApiKey = mailchimpApiKey
  }

  async run() {
    await this.getCalendarData() // TODO: call from publishMailchimpNewsletterTemplate()
    await this.publishMailchimpNewsletterTemplate()
  }

  get serviceDate() { // eslint-disable-line class-methods-use-this
    return dayjs().startOf('week').add(1, 'weeks')
  }

  async buildGsuiteCalendarConnection() {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly', // read-only acccess to calendar entries
    ]
    const client = new GSuiteClient(scopes, this.gsuiteServiceAccount)
    return client.buildConnection('calendar', 'v3')
  }

  async buildGsuiteCalendarManager() {
    const connection = await this.buildGsuiteCalendarConnection()
    return new GSuiteCalendarManager({connection})
  }

  async getCalendarData() {
    const manager = await this.buildGsuiteCalendarManager()
    const calendars = await manager.getCalendars()
      .then(calendarList => calendarList.filter(calendar => !calendar.primary))
    console.info(`Google reports these calendars: ${calendars.map(c => c.summary)}`)
    // calendars.forEach(async (calendar) => {
    const calendar = calendars[0]
    await manager.getEvents({
      calendarId: calendar.id,
      singleEvents: true,
      timeMax: this.serviceDate.endOf('day').toISOString(),
      timeMin: this.serviceDate.subtract(6, 'days').toISOString(),
    }).then((events) => {
      const html = events.map((event) => {
        // TODO: get People/Contacts, indexed by email address and map attendees by email
        console.log(event.attendees)
        const attendees = event.attendees.map(attendee => attendee.email).join(',')
        return `
          <b>${event.summary}</b>: ${attendees}
        `
      })
      console.log(html)
    })
  }

  async getSermonPassage(reference) { // eslint-disable-line class-methods-use-this
    console.info(`Getting ESV text for passage ${reference}`)
    const esvApiKey = await new Secret('EsvApiKey').get()
    return unirest.get('https://api.esv.org/v3/passage/html/')
      .headers({Authorization: esvApiKey})
      .query({
        q: reference,
        'include-footnotes': false,
        'include-headings': false,
        'include-subheadings': false,
        'include-short-copyright': false,
      })
      .then(response => response.body.passages[0])
  }

  async getSpotifyTracks(playlistId) { // eslint-disable-line class-methods-use-this
    console.info(`Getting Spotify tracks for playlist ${playlistId}`)
    const clientId = await new Secret('SpotifyClientId').get()
    const clientSecret = await new Secret('SpotifyClientSecret').get()
    const spotifyApi = new SpotifyWebApi({clientId, clientSecret})

    await spotifyApi.clientCredentialsGrant()
      .then(json => spotifyApi.setAccessToken(json.body.access_token))

    return spotifyApi.getPlaylist(playlistId)
      .then(json => json.body.tracks.items.map(item => item.track.name))
  }

  async getTemplateHtmlFromMailchimp() {
    const templateId = 359089
    const mailchimp = new Mailchimp(this.mailchimpApiKey)

    console.info(`Creating temporary Mailchimp campaign based on template ${templateId}`)
    return mailchimp.client.post('/campaigns', {
      type: 'regular',
      settings: {
        title: 'RedeemerBot - Temporary Campaign To Extract Template HTML',
        template_id: templateId,
      },
    }).then(async (json) => {
      console.info(`Getting template HTML from Mailchimp for generated campaign ${json.id}`)
      const html = await mailchimp.client.get(`/campaigns/${json.id}/content`).then(contentJson => contentJson.html)
      console.info(`Deleting temporary Mailchimp campaign ${json.id}`)
      await mailchimp.client.delete(`/campaigns/${json.id}`)
      return html
    })
  }

  async publishMailchimpNewsletterTemplate() {
    const mailchimp = new Mailchimp(this.mailchimpApiKey)

    const templateHtml = await this.getTemplateHtmlFromMailchimp()
    const $ = cheerio.load(templateHtml)

    // replace the sermon date
    $("[data-redeemer-bot='sermonDate']").text(this.serviceDate.format('dddd, MMMM D, YYYY'))

    // replace the sermon passage
    const reference = 'Psalm 110'
    const passage = await this.getSermonPassage(reference)
    $("[data-redeemer-bot='sermonPassage']")
      .html(`${passage}<a href="http://esv.to/${reference}" target="_blank">Read the full chapter here</a>`)

    // replace the Spotify playlist
    const playlistId = '4OutCdT5HD7S0h7L4T0osu'
    const tracks = await this.getSpotifyTracks(playlistId)
    const playlistLink = `<a href="https://open.spotify.com/playlist/${playlistId}">This week's playlist</a>`
    $("[data-redeemer-bot='serviceMusic']").html(`${playlistLink}<br />${tracks.join('<br />')}`)

    console.info('Publishing the fully fleshed out HTML template to Mailchimp')
    await mailchimp.client.patch('/templates/359109', {
      name: 'RedeemerBot - Processed Newsletter Template',
      html: $.html(),
    }).then(json => console.log(json))
  }
}

class App {
  async run() {
    this.gsuiteServiceAccount = await new Secret('GsuiteServiceAccount').get()
    this.mailchimpApiKey = await new Secret('MailchimpApiKey').get()

    await new MailchimpToGsuiteMembershipSync(this.gsuiteServiceAccount, this.mailchimpApiKey).run()
    await new MailchimpNewsletterGenerator(this.gsuiteServiceAccount, this.mailchimpApiKey).run()
  }
}

new App().run()
  .catch((e) => {
    console.log(e)
    throw e
  })

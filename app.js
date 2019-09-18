// TODO: only load this in dev; not in test, not in prod
require('dotenv').config() // load gcloud credentials in dev

const uniqBy = require('lodash/uniqBy')
const cheerio = require('cheerio')
const dayjs = require('dayjs')
const pluralize = require('pluralize')
const pretty = require('pretty')
const unirest = require('unirest')
const Q = require('q')
const SpotifyWebApi = require('spotify-web-api-node')
const url = require('url')

const {
  ManagerFactory: GSuiteManagerFactory,
} = require('@redeemerbc/gsuite')
const {Secret} = require('@redeemerbc/secret')
const {Mailchimp} = require('./lib/mailchimp')
const {
  MasterSchedule,
  PeopleMapper,
} = require('./lib/redeemerbc')

// TODO: TypeScript, and nuke ow

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
          email: member.email.toLowerCase(),
          name: member.name,
          firstName: member.firstName,
          lastName: member.lastName,
        })
        tagGroups[tagName] = group // eslint-disable-line no-param-reassign
      })
      return tagGroups
    }, {})
  }

  async syncGroupsFromMailchimpToGoogle() {
    const mailchimpGroups = Object.keys(this.mailchimpGroupedUsers).map(group => group.toLowerCase())

    console.info('Synching these Mailchimp groups to GSuite:', mailchimpGroups)
    const scopes = [
      'https://www.googleapis.com/auth/admin.directory.group', // admin access to create/update groups of users XXX: is there a better auth for groups?
    ]
    const manager = await GSuiteManagerFactory
      .groupManager(scopes, this.gsuiteServiceAccount, {domain: 'redeemerbc.com'})

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
    const scopes = [
      'https://www.googleapis.com/auth/admin.directory.group', // admin access to create/update groups of users
    ]
    const manager = await GSuiteManagerFactory
      .groupManager(scopes, this.gsuiteServiceAccount, {domain: 'redeemerbc.com'})
    Object.entries(this.mailchimpGroupedUsers).forEach(async ([group, groupedUsers]) => {
      const mailchimpUsers = groupedUsers.map(user => user.email).sort()
      console.info(`Synching these Mailchimp users to GSuite group '${group}':`, mailchimpUsers)

      const gsuiteUsers = await manager.getUsers(group).then(users => users.map(user => user.email))
      console.info('GSuite reports these users:', gsuiteUsers)

      const usersToDelete = gsuiteUsers.filter(u => !mailchimpUsers.includes(u))
      console.info(`These users exist in GSuite but not in Mailchimp group ${group}:`, usersToDelete)
      await manager.deleteUsers(usersToDelete, group)

      const usersToCreate = mailchimpUsers.filter(u => !gsuiteUsers.includes(u))
      console.info(`These users exist in Mailchimp but not in GSuite group ${group}:`, usersToCreate)
      await manager.insertUsers(usersToCreate, group)
    })
  }

  async syncUsersFromMailchimpIntoGoogleContacts() {
    const mailchimpUsers = uniqBy(Object.values(this.mailchimpGroupedUsers).flat(), 'email')
    const mailchimpUserEmails = mailchimpUsers.map(user => user.email).sort()
    console.info('Synching these Mailchimp users to GSuite contacts:', mailchimpUserEmails)

    const gsuiteContacts = await this.getGSuiteContacts()
    const gsuiteContactEmails = gsuiteContacts.map(user => user.email).sort()
    console.info('GSuite reports these users:', gsuiteContactEmails)

    // TODO: sync first/last name changes from Mailchimp to here; usersToUpdate

    const scopes = [
      'https://www.googleapis.com/auth/contacts', // read/write acccess to contact lists
    ]
    const manager = await GSuiteManagerFactory.peopleManager(scopes, this.gsuiteServiceAccount)

    const usersToDelete = gsuiteContacts.filter(u => !mailchimpUserEmails.includes(u.email))
    console.info('These users exist in GSuite but not in Mailchimp contacts:', usersToDelete)
    await manager.deleteContacts(usersToDelete.map(user => user.resourceName))

    const usersToCreate = mailchimpUsers.filter(u => !gsuiteContactEmails.includes(u.email))
    console.info('These users exist in Mailchimp but not in GSuite contacts:', usersToCreate)
    await manager.createContacts(usersToCreate)
  }

  async getGSuiteContacts() {
    const scopes = [
      'https://www.googleapis.com/auth/contacts.readonly', // read-only acccess to contact lists
    ]
    const manager = await GSuiteManagerFactory.peopleManager(scopes, this.gsuiteServiceAccount)

    return manager.getContacts({
      personFields: 'names,emailAddresses',
    })
  }
}

class MailchimpNewsletterGenerator {
  constructor(gsuiteServiceAccount, mailchimpApiKey) {
    this.gsuiteServiceAccount = gsuiteServiceAccount
    this.mailchimpApiKey = mailchimpApiKey
  }

  async run() {
    await this.publishMailchimpNewsletterTemplate()
  }

  get serviceDate() { // eslint-disable-line class-methods-use-this
    return dayjs().startOf('week').add(1, 'weeks')
  }

  async buildGSuitePeopleMapper() {
    const gsuiteContacts = await this.getGSuiteContacts()
    return new PeopleMapper(gsuiteContacts)
  }

  async getGSuiteContacts() {
    const scopes = [
      'https://www.googleapis.com/auth/contacts.readonly', // read-only acccess to contact lists
    ]
    const manager = await GSuiteManagerFactory.peopleManager(scopes, this.gsuiteServiceAccount)

    return manager.getContacts({
      personFields: 'names,emailAddresses',
    })
  }

  async getCalendarHtml() {
    const peopleMapper = await this.buildGSuitePeopleMapper()

    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly', // read-only acccess to calendar entries
    ]
    const manager = await GSuiteManagerFactory.calendarManager(scopes, this.gsuiteServiceAccount)
    const calendars = await manager.getCalendars()
      .then(calendarList => calendarList
        .filter(calendar => !calendar.primary)
        .sort((a, b) => a.summary.localeCompare(b.summary)))
    console.info(`Google reports these calendars: ${calendars.map(c => c.summary)}`)
    // const html = await calendars.forEach(async (calendar) => {
    // XXX - eeewwww
    // https://decembersoft.com/posts/promises-in-serial-with-array-reduce/
    const calendarPromises = calendars.reduce((promiseChain, calendar) => {
      return promiseChain.then((chainResults) => {
        const currentResult = calendar.getEvents({
          singleEvents: true,
          timeMax: this.serviceDate.endOf('day').toISOString(),
          timeMin: this.serviceDate.subtract(6, 'days').toISOString(),
        }).then((events) => {
          if (events.length == 0) {
            return ''
          }
          const calendarLink = `https://calendar.google.com/calendar?cid=${calendar.id}`
          const calendarHtml = `<dt><b><a href="${calendarLink}">${calendar.summary}</a></b></dt>`
          const eventsHtml = events.map((event) => {
            const eventLabel = event.label.replace(`${calendar.summary} - `, '')
            // TODO: get People/Contacts, indexed by email address and map attendees by email
            const attendees = event.attendees.map(attendee => peopleMapper.personByEmail(attendee).fullName).join(', ')
            return `<dd><i>${eventLabel}</i>: ${attendees}</dd>`
          }).join('')
          return `${calendarHtml} ${eventsHtml}`
        })
        return [...chainResults, currentResult]
      })
    }, Promise.resolve([]))
    const html = await calendarPromises
      .then(arrayOfResults => Promise.all(arrayOfResults))
      .then(htmlArray => `<dl>${htmlArray.filter(Boolean).join('')}</dl>`)
    // console.log(pretty(html))
    // throw 'foo'
    return html
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

    // TODO: Make tracks an object with a sanitizeTrackName() method
    return spotifyApi.getPlaylist(playlistId)
      .then(json => json.body.tracks.items.map(item => item.track.name.replace(' - Live', '')))
  }

  async getTemplateHtmlFromMailchimp() {
    const templateId = 359089
    const mailchimp = new Mailchimp(this.mailchimpApiKey)

    console.info(`Creating temporary Mailchimp campaign based on template ${templateId}`)
    // TODO: extract into mailchimp.createCampaign()
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
    const reference = '1 Peter 5:1-5'
    const passage = await this.getSermonPassage(reference)
    $("[data-redeemer-bot='sermonPassage']")
      .html(`${passage}<a href="http://esv.to/${reference}" target="_blank">Read the full chapter here</a>`)

    // replace the Spotify playlist
    const playlistUrl = 'https://open.spotify.com/playlist/2HoaFy0dLN5hs0EbMcUdJU'
    const playlistId = url.parse(playlistUrl).pathname.split('/').slice(-1)[0]
    const tracks = await this.getSpotifyTracks(playlistId)
    const playlistLink = `<b>This week's playlist, on <a href="https://open.spotify.com/playlist/${playlistId}">Spotify</a>`
      + ' and <a href="https://music.youtube.com/playlist?list=PLt11S0kjDvef_xLiQv103MdVRe1LiPGG0">YouTube</a></b><br />'
    $("[data-redeemer-bot='serviceMusic']").html(`${playlistLink}<br />${tracks.join('<br />')}`)

    const calendarHtml = await this.getCalendarHtml()
    // TODO: add CSS around this so the pretty template looks good
    $("[data-redeemer-bot='weeklyCalendars']").html(calendarHtml)

    console.info('Publishing the fully fleshed out HTML template to Mailchimp')
    await mailchimp.client.patch('/templates/359109', {
      name: 'RedeemerBot - Processed Newsletter Template',
      html: pretty($.html(), {ocd: true}),
    }).then(json => console.log(json))
  }
}

class GoogleSheetsToGoogleCalendarSync {
  constructor(gsuiteServiceAccount) {
    this.gsuiteServiceAccount = gsuiteServiceAccount
  }

  async run() {
    // TODO: GSuite "Error: Rate Limit Exceeded"
    // TODO: GSuite "Calendar usage limits exceeded"
    const masterSchedule = await this.getSheetsMasterSchedule()
    const scheduleGroups = masterSchedule.subSchedules.reduce((table, schedule) => {
      table[schedule.calendarId] = table[schedule.calendarId] || [] // eslint-disable-line no-param-reassign
      table[schedule.calendarId].push(schedule)
      return table
    }, {})

    /*
    const index = 3
    const myScheduleGroup = Object.values(scheduleGroups)[index]
    const myCalendarId = Object.keys(scheduleGroups)[index]
    return await this.syncScheduleGroupToGoogleCalendar(myCalendarId, myScheduleGroup)
    */

    Object.keys(scheduleGroups).forEach(async (calendarId) => {
      const scheduleGroup = scheduleGroups[calendarId]
      await this.syncScheduleGroupToGoogleCalendar(calendarId, scheduleGroup)
    })
  }

  async buildGSuitePeopleMapper() {
    const gsuiteContacts = await this.getGSuiteContacts()
    return new PeopleMapper(gsuiteContacts)
  }

  async getGSuiteContacts() {
    const scopes = [
      'https://www.googleapis.com/auth/contacts.readonly', // read-only acccess to contact lists
    ]
    const manager = await GSuiteManagerFactory.peopleManager(scopes, this.gsuiteServiceAccount)

    return manager.getContacts({
      personFields: 'names,emailAddresses',
    })
  }

  async getSheetsMasterSchedule() {
    const scopes = [
      'https://www.googleapis.com/auth/spreadsheets.readonly', // read-only access to spreadsheets
    ]
    const manager = await GSuiteManagerFactory.sheetsManager(scopes, this.gsuiteServiceAccount)
    const masterScheduleSheetId = '1RMPEOOnIixOftIKt5VGA1LBQFoWh0-_ohnt34JTnpWw'
    const masterScheduleSheet = await manager.getSpreadsheet(masterScheduleSheetId)
    const sheet = masterScheduleSheet.getSheet(0)
    const allCells = await manager.getRange({
      spreadsheetId: masterScheduleSheetId,
      range: sheet.sheetName,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'FORMULA',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    })
    return new MasterSchedule({data: allCells.data})
  }

  async syncScheduleGroupToGoogleCalendar(calendarId, scheduleGroup) {
    // TODO: CalendarManager and friends should provide scope enums: READ_WRITE, READ_ONLY
    const scopes = [
      'https://www.googleapis.com/auth/calendar', // read/write acccess to calendar entries
    ]
    const manager = await GSuiteManagerFactory.calendarManager(scopes, this.gsuiteServiceAccount)

    const events = scheduleGroup.reduce((eventList, schedule) => {
      eventList.push(schedule.events)
      return eventList
    }, []).flat()
    // TODO: timeMin should be max(firstEvent, today()) - that is, don't change events that already happened
    // - need to also filter out old scheduleEvents so we don't re-create old events
    const firstEvent = events[0]
    const lastEvent = events.slice(-1).pop()
    const calendar = await manager.getCalendar(calendarId)
    const existingCalendarEvents = await calendar.getEvents({
      singleEvents: true,
      timeMin: firstEvent.startDateTime.startOf('day').toISOString(),
      timeMax: lastEvent.endDateTime.endOf('day').toISOString(),
    })

    const peopleMapper = await this.buildGSuitePeopleMapper()
    const scheduleEvents = events.map(e => e.simulateAGoogleCalendarEvent(calendar, peopleMapper))

    class EventSyncer {
      constructor(options = {}) {
        /*
        ow(options, ow.exactShape({
          scheduleEvent: ow.optional.object,
          calendarEvent: ow.optional.object,
        }))
        */
        this.props = options
      }

      get scheduleEvent() {
        return this.props.scheduleEvent
      }

      set scheduleEvent(scheduleEvent) {
        this.props.scheduleEvent = scheduleEvent
      }

      get calendarEvent() {
        return this.props.calendarEvent
      }

      set calendarEvent(calendarEvent) {
        this.props.calendarEvent = calendarEvent
      }

      get shouldDeleteCalendarEvent() {
        return this.calendarEvent && !this.scheduleEvent
      }

      get shouldCreateCalendarEvent() {
        return !this.calendarEvent && this.scheduleEvent
      }

      serializeEvent(event) { // eslint-disable-line class-methods-use-this
        return `${event.label} - ${dayjs(event.start).toISOString()} - ${dayjs(event.end).toISOString()} - ${event.attendees.sort()}`
      }

      serializeCalendarEvent() {
        return this.serializeEvent(this.calendarEvent)
      }

      serializeScheduleEvent() {
        return this.serializeEvent(this.scheduleEvent)
      }

      /*
      get eventsAreSynced() {
        return this.scheduleEvent && this.calendarEvent && !this.shouldUpdateCalendarEvent
      }
      */

      get shouldUpdateCalendarEvent() {
        return this.serializeCalendarEvent() !== this.serializeScheduleEvent()
      }

      get syncActionName() {
        if (this.shouldDeleteCalendarEvent) {
          return 'delete'
        }
        if (this.shouldCreateCalendarEvent) {
          return 'create'
        }
        if (this.shouldUpdateCalendarEvent) {
          return 'update'
        }
        return 'synced'
      }

      async sync() {
        return Promise.resolve()
        if (this.shouldDeleteCalendarEvent) {
          return this.deleteCalendarEvent()
        }
        if (this.shouldCreateCalendarEvent) {
          return this.createCalendarEvent()
        }
        if (this.shouldUpdateCalendarEvent) {
          return this.updateCalendarEvent()
        }
        return Promise.resolve()
      }

      async deleteCalendarEvent() {
        return this.calendarEvent.deleteEvent({
          sendUpdates: 'none',
        })
      }

      async createCalendarEvent() {
        // TODO: reconcile all this naming: scheduleEvent -> spreadsheetEvent
        return this.scheduleEvent.createEvent({
          sendUpdates: 'none',
        })
      }

      async updateCalendarEvent() {
        return this.calendarEvent.updateEvent({
          sendUpdates: 'all',
          resource: this.scheduleEvent.properties,
        })
      }
    }

    class EventMapper {
      constructor() {
        this.eventMap = {}
      }

      push(event) {
        // ow(event, ow.object)
        const eventId = `${event.label} - ${dayjs(event.start).startOf('day')}`
        const syncer = this.eventMap[eventId] || new EventSyncer()
        if (event.id) {
          syncer.calendarEvent = event
        } else {
          syncer.scheduleEvent = event
        }
        this.eventMap[eventId] = syncer
      }

      get eventPairs() {
        return Object.values(this.eventMap)
      }

      toActionBuckets() {
        return this.eventPairs.reduce((buckets, syncer) => {
          const action = syncer.syncActionName
          buckets[action] = buckets[action] || [] // eslint-disable-line no-param-reassign
          buckets[action].push(syncer)
          return buckets
        }, {})
      }
    }

    const eventMapper = new EventMapper()
    scheduleEvents.concat(existingCalendarEvents).forEach(event => eventMapper.push(event))
    const eventActionBuckets = Object.assign(
      {
        synced: [],
        update: [],
        create: [],
        delete: [],
      },
      eventMapper.toActionBuckets(),
    )

    console.info(`These Spreadsheet events have previously been synced to Calendar '${calendar.summary}'`,
      eventActionBuckets.synced.map(e => e.serializeCalendarEvent()))

    console.info(`These Spreadsheet events will be updated in Calendar '${calendar.summary}'`,
      eventActionBuckets.update.map(e => `${e.serializeCalendarEvent()} => ${e.serializeScheduleEvent()}`))
    await eventActionBuckets.update.map(e => e.sync()).reduce(Q.when, Q())

    console.info(`These Spreadsheet events will be created in Calendar '${calendar.summary}'`,
      eventActionBuckets.create.map(e => e.serializeScheduleEvent()))
    // await eventActionBuckets.create.map(e => e.sync()).reduce(Q.when, Q())
    // TODO: desperately need to understand how to serialize execution of async promises
    // - need to sync each event in serial, because this map is executing them all simultaneously
    //   and flooding my rate limit something awful
    // - need to also nuke this seemingly unhelpful Q library
    await eventActionBuckets.create.slice(0, 3).map(e => e.sync()).reduce(Q.when, Q())

    console.info(`These Calendar events will be deleted from Calendar '${calendar.summary}'`,
      eventActionBuckets.delete.map(e => e.serializeCalendarEvent()))
    await eventActionBuckets.delete.map(e => e.sync()).reduce(Q.when, Q())
  }
}

class App {
  async run() {
    this.gsuiteServiceAccount = await new Secret('GsuiteServiceAccount').get()
    this.mailchimpApiKey = await new Secret('MailchimpApiKey').get()

    // await new MailchimpToGsuiteMembershipSync(this.gsuiteServiceAccount, this.mailchimpApiKey).run()
    // await new MailchimpNewsletterGenerator(this.gsuiteServiceAccount, this.mailchimpApiKey).run()
    await new GoogleSheetsToGoogleCalendarSync(this.gsuiteServiceAccount).run()
  }
}

new App().run()
  .catch((e) => {
    console.log(e)
    throw e
  })

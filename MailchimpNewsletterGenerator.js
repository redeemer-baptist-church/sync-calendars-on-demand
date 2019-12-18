require('dotenv').config() // load gcloud credentials in dev

const camelCase = require('lodash/camelCase')
const cheerio = require('cheerio')
const dayjs = require('dayjs')
const pretty = require('pretty')
const unirest = require('unirest')
const SpotifyWebApi = require('spotify-web-api-node')
const url = require('url')

const {
  ManagerFactory: GSuiteManagerFactory,
} = require('@redeemerbc/gsuite')
const {Secret} = require('@redeemerbc/secret')
const {serialize} = require('@redeemerbc/serialize')
const {Mailchimp} = require('./lib/mailchimp')
const {PeopleMapper} = require('./lib/redeemerbc')

class MailchimpNewsletterGenerator {
  async run() {
    this.gsuiteServiceAccount = await new Secret('GsuiteServiceAccount').get()
    this.mailchimpApiKey = await new Secret('MailchimpApiKey').get()

    this.peopleMapper = await this.buildGSuitePeopleMapper()
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

  async buildEventsHtmlForCalendar(calendar) {
    return calendar.getEvents({
      singleEvents: true,
      timeMax: this.serviceDate.endOf('day').toISOString(),
      timeMin: this.serviceDate.subtract(6, 'days').toISOString(),
    }).then((events) => {
      if (events.length === 0) {
        return ''
      }
      const calendarLink = `https://calendar.google.com/calendar?cid=${calendar.id}`
      const calendarHtml = `<dt><b><a href="${calendarLink}">${calendar.summary}</a></b></dt>`
      const eventsHtml = events.map((event) => {
        const eventLabel = event.label.replace(`${calendar.summary} - `, '')
        const attendees = event.attendees.map(attendee => this.peopleMapper.personByEmail(attendee).fullName)
          .join(', ') || event.description
        return `<dd><i>${eventLabel}</i>: ${attendees}</dd>`
      }).join('')
      return `${calendarHtml} ${eventsHtml}`
    })
  }

  async getCalendarHtml() {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly', // read-only acccess to calendar entries
    ]
    const manager = await GSuiteManagerFactory.calendarManager(scopes, this.gsuiteServiceAccount)
    // TODO: filter out Scripture Reading and other non-human calendars
    const calendars = await manager.getCalendars()
      .then(calendarList => calendarList
        .filter(calendar => !calendar.primary)
        .sort((a, b) => a.summary.localeCompare(b.summary)))
    console.info(`Google reports these calendars: ${calendars.map(c => c.summary)}`)
    const html = await serialize(calendars.map(calendar => () => this.buildEventsHtmlForCalendar(calendar)))
      .then(htmlArray => `<dl>${htmlArray.filter(Boolean).join('')}</dl>`)
    const masterScheduleUrl = 'https://docs.google.com/spreadsheets/d/1RMPEOOnIixOftIKt5VGA1LBQFoWh0-_ohnt34JTnpWw/edit#gid=0' // eslint-disable-line max-len
    const masterScheduleHtml = `<dt><b><a href="${masterScheduleUrl}">Master Schedule</a></b></dt>`

    return `${html}${masterScheduleHtml}`
  }

  async getScriptureReferencesFromCalendar() {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly', // read-only acccess to calendar entries
    ]
    const manager = await GSuiteManagerFactory.calendarManager(scopes, this.gsuiteServiceAccount)
    const calendarId = 'redeemerbc.com_gmiihbof3pt28k6lngkoufabqk@group.calendar.google.com'
    const calendar = await manager.getCalendar(calendarId)

    return calendar.getEvents({
      singleEvents: true,
      timeMax: this.serviceDate.endOf('day').toISOString(),
      timeMin: this.serviceDate.subtract(6, 'days').toISOString(),
    }).then(events => events.reduce((table, e) => {
      const htmlId = camelCase(e.label.replace(`${calendar.summary} - `, ''))
      const passages = e.description.split('\n')
      table[htmlId] = passages // eslint-disable-line no-param-reassign
      return table
    }, {}))
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

  async getSermonPassageHtml(reference) {
    const passage = await this.getSermonPassage(reference)
    return `${passage}<a href="http://esv.to/${reference}" target="_blank">Read the full passage here</a>`
  }

  async buildSermonPassageHtml(references) {
    return serialize(references.map(reference => () => this.getSermonPassageHtml(reference)))
      .then(html => html.join(''))
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
      .then(json => json.body.tracks.items.map(item => item.track.name
        .replace(' - Live', '')
        .replace(' (Acoustic)', '')))
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

    // replace the sermon passages
    const references = await this.getScriptureReferencesFromCalendar()
    $("[data-redeemer-bot='scriptureReading']").html(await this.buildSermonPassageHtml(references.scriptureReading))
    $("[data-redeemer-bot='sermonPassage']").html(await this.buildSermonPassageHtml(references.sermonPassage))

    // replace the Spotify playlist
    const spotifyPlaylistUrl = 'https://open.spotify.com/playlist/2HoaFy0dLN5hs0EbMcUdJU'
    const spotifyPlaylistId = url.parse(spotifyPlaylistUrl).pathname.split('/').slice(-1)[0]
    const tracks = await this.getSpotifyTracks(spotifyPlaylistId)
    const spotifyUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`
    const youtubeUrl = 'https://music.youtube.com/playlist?list=PLt11S0kjDvef_xLiQv103MdVRe1LiPGG0'
    const playlistLink = `<b>This week's playlist, on <a href="${spotifyUrl}">Spotify</a>`
      + ` and <a href="${youtubeUrl}">YouTube</a></b><br />`
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

new MailchimpNewsletterGenerator().run()
  .catch((e) => {
    console.log(e)
    throw e
  })

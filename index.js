const {GoogleSheetsToGoogleCalendarSync} = require('./GoogleSheetsToGoogleCalendarSync')

module.exports = {
  run: (request, response) => new GoogleSheetsToGoogleCalendarSync().run()
    .then(() => {
      response.send('done')
    })
    .catch((e) => {
      console.log(e)
      throw e
    }),
}

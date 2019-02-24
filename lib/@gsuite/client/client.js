const {google} = require('googleapis')
const ow = require('ow')

class Client {
  constructor(scopes = [], subject = undefined) {
    ow(scopes, ow.array) // TODO: validate that scopes are actually gsuite-style scopes
    ow(subject, ow.any(ow.undefined, ow.string))
    this.props = {}
    this.props.scopes = scopes
    this.props.subject = subject
  }

  async buildConnection(version) {
    return this.buildAuth().then(auth => google.admin({version, auth}))
  }

  async buildAuth() {
    this._auth = this._auth || await google.auth.getClient({
      scopes: this.props.scopes,
    })
    this._auth.subject = this.props.subject
    return this._auth
  }
}

module.exports = {Client}

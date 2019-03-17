const ow = require('ow')
const {sleep} = require('../../sleep')

class GroupManager {
  constructor(options) {
    ow(options, ow.object.exactShape({
      domain: ow.string,
      connection: ow.object,
    }))
    this.props = options
  }

  get connection() {
    return this.props.connection
  }

  get domain() {
    return this.props.domain
  }

  async createGroups(groupNames) {
    ow(groupNames, ow.array.ofType(ow.string))
    return groupNames.map(groupName => this.createGroup(groupName))
  }

  async createGroup(groupName) {
    ow(groupName, ow.string)
    console.info('GSuiteGroupManager: creating group:', groupName)
    const email = this.buildEmail(groupName)
    return this.connection.groups.insert({requestBody: {email}})
      // TODO: instead of a hard sleep, check for the group every 500 ms, and then return
      // TODO: This sleep isn't working; the thread is NOT blocking; figure out why
      // block for GSuite eventual consistency
      .then(async () => await sleep(3000)) // eslint-disable-line no-return-await
      .catch(e => this.error(e))
  }

  async deleteGroups(groupNames) {
    ow(groupNames, ow.array.ofType(ow.string))
    return groupNames.map(groupName => this.deleteGroup(groupName))
  }

  async deleteGroup(groupName) {
    ow(groupName, ow.string)
    console.info('GSuiteGroupManager: deleting group:', groupName)
    const email = this.buildEmail(groupName)
    return this.connection.groups.delete({groupKey: email}).catch(e => this.error(e))
  }

  async getGroups() {
    return this.connection.groups.list({domain: this.domain})
      .then(response => response.data.groups || [])
      .catch(e => this.error(e))
  }

  async getUsers(groupName) {
    ow(groupName, ow.string)
    console.info(`GSuiteGroupManager: getting users for the '${groupName}' GSuite group`)
    return this.connection.members.list({groupKey: this.buildEmail(groupName)})
      .then(response => response.data.members || [])
      .catch(e => this.error(e))
  }

  async insertUsers(emailAddresses, groupName) {
    ow(emailAddresses, ow.array.ofType(ow.string))
    ow(groupName, ow.string)
    return emailAddresses.map(email => this.insertUser(email, groupName))
  }

  async insertUser(email, groupName) {
    ow(email, ow.string)
    ow(groupName, ow.string)
    console.info(`GSuiteGroupManager: adding '${email}' to the '${groupName}' GSuite group`)
    return this.connection.members.insert({
      groupKey: this.buildEmail(groupName),
      requestBody: {email},
    })
  }

  async deleteUsers(emailAddresses, groupName) {
    ow(emailAddresses, ow.array.ofType(ow.string))
    ow(groupName, ow.string)
    return emailAddresses.map(email => this.deleteUser(email, groupName))
  }

  async deleteUser(userEmail, groupName) {
    ow(userEmail, ow.string)
    ow(groupName, ow.string)
    console.info(`GSuiteGroupManager: deleting user from group ${groupName}:`, userEmail)
    const groupEmail = this.buildEmail(groupName)
    return this.connection.members.delete({
      groupKey: groupEmail,
      memberKey: userEmail,
    }).catch(e => this.error(e))
  }

  buildEmail(groupName) {
    ow(groupName, ow.string)
    return `${groupName}@${this.domain}`
  }

  error(e) { // eslint-disable-line class-methods-use-this
    console.log(e)
    throw e
  }
}

module.exports = {GroupManager}

class Member {
  constructor(memberJson) {
    this.json = memberJson
  }

  get email() {
    return this.json.email_address
  }

  get name() {
    return `${this.firstName} ${this.lastName}`
  }

  get firstName() {
    return this.json.merge_fields.FNAME
  }

  get lastName() {
    return this.json.merge_fields.LNAME
  }

  get tags() {
    return this.json.tags
  }
}

module.exports = {Member}

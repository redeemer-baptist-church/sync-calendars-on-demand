const ow = require('ow')
const {Firestore} = require('@google-cloud/firestore')

class Secret {
  constructor(secretName) {
    ow(secretName, ow.string)
    this.secretName = secretName
  }

  get collection() {
    return this._collection || this.buildCollection()
  }

  async get() {
    const doc = await this.doc.get()
    return doc.data().secret
  }

  async set(secretValue) {
    ow(secretValue, ow.not.undefined)
    this.doc.set({
      secret: secretValue,
    })
  }

  buildCollection() {
    this._collection = new Firestore().collection('secrets')
    return this._collection
  }

  get doc() {
    return this.collection.doc(this.secretName)
  }
}

module.exports = {Secret}

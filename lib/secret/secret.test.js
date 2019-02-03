const {Secret} = require('./secret')

describe('Secret class', () => {
  function secret() {
    return new Secret('testKey')
  }

  // TODO:
  // it validates secretName in the constructor
  // it validates secretValue in set

  // XXX - this should probably go away - we don't really care
  it('builds a Google Firestore collection', () => {
    expect(secret().collection.constructor.name).toEqual('CollectionReference')
  })

  // XXX - this should probably go away - we don't really care
  it('builds a Google Firestore document', () => {
    expect(secret().doc.constructor.name).toEqual('DocumentReference')
  })

  xit('can retrieve the value of a secret', () => {
    expect(secret().get()).toEqual('this is a secret')
  })
})

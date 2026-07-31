// The first thirty seconds: the look, then whether the shelf follows you, then a
// first book. A welcome, not a form — every step can be skipped and the app works.
import { askConfirm } from '../ui/dialog.js'
import { isConfigured, signIn } from '../state/auth.js'

export async function runFirstRun({ vibePicker, bookModal }){
  await new Promise(resolve => vibePicker.open({ firstRun: true, onClosed: resolve }))

  if(isConfigured){
    const wantsAccount = await askConfirm({
      title: 'Keep your shelf everywhere?',
      body: 'Sign in and your books follow you to your phone, your laptop, anywhere you open this.\n\n' +
            'Or use it on this device alone — everything works either way, and you can sign in later ' +
            'from The Hidden Shelf.',
      confirm: 'Sign in with Google',
      cancel: 'Just use it on this device'
    })
    if(wantsAccount) await signIn(() => {})
  }

  const addNow = await askConfirm({
    title: 'What are you reading?',
    body: 'Search for it and it arrives with its cover, its author and its series already filled in.\n\n' +
          'You can hold up to three books at once.',
    confirm: 'Add a book',
    cancel: 'Not just now'
  })
  if(addNow) bookModal.open({ dest: 'current' })
}

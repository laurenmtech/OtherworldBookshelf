// The first thirty seconds: the look, then whether the shelf follows you, then
// where it lives, then a first book. A welcome, not a form — every step can be
// skipped and the app works.
//
// Adding it to the home screen comes THIRD, not last, so the flow still ends by
// handing you into the app doing the thing it's for.
import { askConfirm, showMessage } from '../ui/dialog.js'
import { isConfigured, signIn } from '../state/auth.js'
import { canOfferInstall, hasInstallPrompt, promptInstall } from './install.js'

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

  // Only where there's a home screen to add it to, and only when it isn't
  // already there. Two shapes, because only one of them can be a question: where
  // the browser hands us a real installer, "yes" does the thing — on iOS there
  // is no such event, so all we can honestly do is say where the button is.
  if(canOfferInstall()){
    if(hasInstallPrompt()){
      const install = await askConfirm({
        title: 'Keep it on your phone?',
        body: 'It gets its own icon on your home screen and opens like an app — no address bar, ' +
              'and your shelf still there with no signal.\n\n' +
              'You can do this later from The Hidden Shelf.',
        confirm: 'Add to Home Screen',
        cancel: 'Not just now'
      })
      if(install) await promptInstall()
    } else {
      await showMessage({
        title: 'Keep it on your phone',
        body: 'Tap Share, then Add to Home Screen. It gets its own icon and opens like an app — ' +
              'no address bar, and your shelf still there with no signal.\n\n' +
              'It arrives as TBR. This is in The Hidden Shelf too, whenever you want it.',
        close: 'Got it'
      })
    }
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

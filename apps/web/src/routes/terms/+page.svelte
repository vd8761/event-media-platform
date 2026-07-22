<script lang="ts">
  // Terms and conditions. Public route for the same reason as the privacy
  // policy — a guest with only a gallery link must be able to read it.
  //
  // The liability cap in section 11 and the jurisdiction clause in section 14
  // are drafted, not advised — they are the two clauses that most want counsel
  // sign-off before this is relied on commercially.
  import Logo from '$lib/components/Logo.svelte';

  const LAST_UPDATED = '22 July 2026';
</script>

<svelte:head>
  <title>Terms &amp; Conditions — EventLens</title>
  <meta name="description" content="The terms governing your use of EventLens." />
</svelte:head>

<div class="mx-auto max-w-3xl px-5 py-12">
  <a href="/" class="mb-8 flex items-center gap-2"><Logo /> <span class="text-lg font-semibold">EventLens</span></a>

  <h1 class="mb-2 text-3xl font-semibold">Terms &amp; Conditions</h1>
  <p class="mb-10 text-sm text-gray-500">Last updated {LAST_UPDATED}</p>

  <div class="legal">
    <p class="lead">
      These terms govern your use of EventLens, an event photography platform operated by Touchmark Descience Pvt. Ltd
      at eventlens.touchmarkdes.com. By creating an account, uploading photos, or opening a gallery link, you accept
      them.
    </p>

    <h2>1. Who these terms apply to</h2>
    <p>
      Some of what follows applies only to <strong>organisers</strong> — photographers, studios and event companies who
      hold an account and upload photos. The rest applies to <strong>guests</strong>, who receive a link to photos from
      an event they attended. Each section says which.
    </p>

    <h2>2. Accounts</h2>
    <p>
      Accounts are for organisers. You must be 18 or older and provide accurate details. You are responsible for what
      happens under your account and for keeping your password to yourself. Tell us promptly if you think someone else
      has access.
    </p>
    <p>
      Each organiser account belongs to an organisation, which has a plan setting how much storage and how many events
      it may use. You can see your current usage against those limits in the application at any time.
    </p>

    <h2>3. Your photos remain yours</h2>
    <p>
      <strong>Organisers:</strong> you keep every right you had in the photos and videos you upload. We claim no
      ownership.
    </p>
    <p>
      You give us a limited licence to host, store, process, resize and transmit your content — including running face
      detection on it — purely so that we can provide the service to you and to the guests you share it with. That
      licence exists only to run EventLens. It ends when you delete the content or close your account. We do not
      license your photos to anyone else, use them to promote EventLens, or use them to train machine learning models.
    </p>

    <h2>4. What you may upload</h2>
    <p><strong>Organisers.</strong> By uploading, you confirm that:</p>
    <ul>
      <li>You own the content or have the rights to use it this way.</li>
      <li>
        You have whatever permission is needed from the people in the photos for them to be uploaded and processed with
        facial recognition. This is your responsibility, not ours — you were at the event and we were not.
      </li>
      <li>The content is lawful.</li>
    </ul>
    <p>You may not use EventLens to store or share:</p>
    <ul>
      <li>Content that infringes anyone's copyright, trademark or privacy.</li>
      <li>Sexual content involving minors, or any content that sexualises a child. Ever, under any circumstances.</li>
      <li>Intimate images of anyone shared without their consent.</li>
      <li>Content that is unlawful, harassing, or intended to threaten or intimidate.</li>
      <li>Malware, or anything intended to disrupt the service.</li>
    </ul>
    <p>
      We do not routinely review uploads — an organiser's photos are private to their organisation, which is
      deliberate. But we will act on credible reports, and we will report child sexual abuse material to the
      authorities.
    </p>

    <h2>5. Facial recognition</h2>
    <p>
      EventLens detects faces in uploaded photos and can match a guest's selfie to the photos they appear in. How this
      works and what we retain is set out in our <a href="/privacy">Privacy Policy</a>.
    </p>
    <p>
      <strong>Organisers:</strong> obtaining consent from the people at your event is your obligation. If you operate
      somewhere that requires explicit consent before biometric processing, you must collect it before uploading.
    </p>
    <p>
      <strong>Guests:</strong> submitting a selfie is your choice. You can ask us to delete it and the template derived
      from it at any time, and we will.
    </p>
    <p>
      Face matching is probabilistic. It will sometimes miss a photo you are in and occasionally suggest one you are
      not. It is a convenience, not a guarantee, and should not be relied on as proof that someone was or was not
      present.
    </p>

    <h2>6. Guest galleries</h2>
    <p>
      Guest links are private and specific to one person. Anyone who has the link can see that gallery, so please do
      not forward it. Organisers can regenerate a link, which immediately stops the old one working, and can set an
      expiry date after which the gallery closes.
    </p>

    <h2>7. Deletion, expiry, and what cannot be undone</h2>
    <p>We would rather be blunt about this than have you discover it at the wrong moment.</p>
    <ul>
      <li>
        <strong>Deleting an event permanently destroys its photos and videos.</strong> The media is removed from our
        storage straight away. There is no recovery, no restore window, and no backup we can retrieve it from.
      </li>
      <li>
        <strong>Deleting individual photos</strong> removes them from every gallery immediately and from storage after
        a short grace period.
      </li>
      <li>
        <strong>Expiry</strong> closes guest links on the date the organiser sets. Media is removed later, on a
        separate schedule, and until that point the organiser can still extend the event.
      </li>
    </ul>
    <p>
      Keep your own copies of anything you cannot afford to lose. EventLens is a delivery platform, not an archive or a
      backup service.
    </p>

    <h2>8. Plans, limits and payment</h2>
    <p>
      EventLens is offered in tiers. Each tier sets how much storage your organisation has and how many events it may
      run at once, and your current usage against those limits is visible in the application at all times.
    </p>
    <p>
      <strong>There is no payment on this website.</strong> You cannot buy or upgrade a plan here, and we do not
      collect card details through EventLens. Tiers are arranged directly with us — we agree the tier that suits your
      requirement, and it is activated on your account once you confirm. Any charges, invoicing and applicable taxes
      are handled under that separate arrangement, not through this service.
    </p>
    <p>
      If your arrangement with us ends or is not renewed, we will tell you before your account is closed and give you a
      reasonable opportunity to download your content. We will not delete media without notice for a commercial
      reason.
    </p>

    <h2>9. Availability</h2>
    <p>
      We work to keep EventLens available and to process uploads promptly, but we do not promise uninterrupted service.
      Maintenance, provider outages and faults happen. Face detection runs on GPU capacity that is started on demand,
      so processing time varies with load — a large upload may take a while to work through.
    </p>
    <p>
      <strong>We do not offer an uptime guarantee or a service level agreement.</strong> We aim to keep EventLens
      running well and to fix problems promptly, but we make no binding commitment about availability or response
      times. If your event depends on photos being delivered by a particular moment, plan accordingly and keep your
      own copies.
    </p>

    <h2>10. Suspension</h2>
    <p>
      We may suspend or close an account that breaches these terms, that is being used unlawfully, or that puts the
      service or other customers at risk. Except where the breach is serious or we are legally obliged to act
      immediately, we will tell you first and give you a chance to put it right. Where we can, we will give you a
      reasonable opportunity to export your content before it is removed.
    </p>

    <h2>11. Our liability</h2>
    <p>
      EventLens is provided as it is. To the extent the law allows, we exclude implied warranties, and we are not
      liable for indirect or consequential loss, lost profits, or lost data beyond what we can restore.
    </p>
    <p>
      Nothing here limits liability that cannot lawfully be limited — including for death or personal injury caused by
      negligence, or for fraud.
    </p>
    <p>
      Where liability is not excluded, our total liability to you for all claims arising in any twelve-month period is
      limited to the greater of: the fees you paid us for EventLens in the twelve months before the claim arose, or
      ₹10,000. Where no fees have been paid, that floor is the cap.
    </p>
    <p>
      In particular, we are not liable for content lost through your own deletion. Deleting an event destroys its
      photos immediately and permanently, as section 7 explains, and we cannot recover it.
    </p>

    <h2>12. Indemnity</h2>
    <p>
      <strong>Organisers:</strong> if someone brings a claim against us because of content you uploaded — because you
      did not hold the rights to it, or did not have the consent needed to process the faces in it — you agree to cover
      our reasonable costs in dealing with that claim.
    </p>

    <h2>13. Changes to these terms</h2>
    <p>
      We may update these terms. If a change materially affects you we will give notice in the application and by email
      before it takes effect. Continuing to use EventLens after that means you accept the new terms.
    </p>

    <h2>14. Governing law</h2>
    <p>
      These terms are governed by the laws of India, and the courts at Chennai, Tamil Nadu have exclusive jurisdiction
      over any dispute arising from them.
    </p>
    <p>
      EventLens is available to customers outside India. If you use it from another country you do so on your own
      initiative and are responsible for complying with your local law — including any law governing photography,
      consent, or the processing of biometric data at your events. Nothing here removes any protection that the
      mandatory consumer law of your own country gives you and that cannot lawfully be waived.
    </p>

    <h2>15. Contact</h2>
    <p>
      Touchmark Descience Pvt. Ltd, Tamarai Tech Park (Level 5), S.P. Plot No. 16-19 &amp; 20-A, Thiru Vi Ka Industrial
      Estate, Guindy, Chennai, Tamil Nadu 600032, India.
    </p>
    <p>
      <a href="mailto:info@touchmarkdes.com">info@touchmarkdes.com</a> · +91 44 4065 2648
    </p>
  </div>
</div>

<style>
  .legal :global(h2) {
    margin-top: 2.5rem;
    margin-bottom: 0.75rem;
    font-size: 1.35rem;
    font-weight: 600;
  }
  .legal :global(p),
  .legal :global(li) {
    line-height: 1.75;
  }
  .legal :global(p) {
    margin-bottom: 1rem;
  }
  .legal :global(.lead) {
    font-size: 1.05rem;
  }
  .legal :global(ul) {
    margin-bottom: 1rem;
    padding-inline-start: 1.25rem;
    list-style: disc;
  }
  .legal :global(li) {
    margin-bottom: 0.5rem;
  }
  .legal :global(a) {
    text-decoration: underline;
  }
  .legal :global(.note) {
    border-inline-start: 3px solid rgb(245 158 11);
    background: rgb(245 158 11 / 0.08);
    padding: 0.75rem 1rem;
    font-size: 0.9rem;
  }
</style>

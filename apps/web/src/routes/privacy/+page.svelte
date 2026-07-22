<script lang="ts">
  // Privacy policy. Public route, outside (app) — it has to be readable by
  // someone who has not signed in, and by a guest who only ever received a
  // gallery link.
  //
  // Every technical claim here is one the codebase actually supports, and the
  // company details are Touchmark's own. The liability and jurisdiction terms
  // in the accompanying Terms & Conditions still want a lawyer's eye before
  // this pair is relied on commercially.
  import Logo from '$lib/components/Logo.svelte';

  const LAST_UPDATED = '22 July 2026';
</script>

<svelte:head>
  <title>Privacy Policy — EventLens</title>
  <meta name="description" content="How EventLens collects, uses, stores and protects your data." />
</svelte:head>

<div class="mx-auto max-w-3xl px-5 py-12">
  <a href="/" class="mb-8 flex items-center gap-2"><Logo /> <span class="text-lg font-semibold">EventLens</span></a>

  <h1 class="mb-2 text-3xl font-semibold">Privacy Policy</h1>
  <p class="mb-10 text-sm text-gray-500">Last updated {LAST_UPDATED}</p>

  <div class="legal">
    <p class="lead">
      EventLens is an event photography platform operated by Touchmark Descience Pvt. Ltd. Photographers and event
      organisers upload photos to it; guests find the photos they appear in. Because that involves people's faces, we
      have written this policy to be specific about what we hold and for how long, rather than to be broadly reassuring.
    </p>

    <h2>Who we are</h2>
    <p>
      Touchmark Descience Pvt. Ltd, a company incorporated in India, with its registered office at Tamarai Tech Park
      (Level 5), S.P. Plot No. 16-19 &amp; 20-A, Thiru Vi Ka Industrial Estate, Guindy, Chennai, Tamil Nadu 600032,
      India. EventLens is operated at eventlens.touchmarkdes.com.
    </p>
    <p>
      For anything in this policy, write to <a href="mailto:info@touchmarkdes.com">info@touchmarkdes.com</a> or call
      +91 44 4065 2648.
    </p>

    <h2>Two kinds of people use EventLens</h2>
    <p>
      The distinction matters throughout this policy, because we hold quite different data about each and act in a
      different capacity.
    </p>
    <ul>
      <li>
        <strong>Organisers</strong> — photographers, studios and event companies with an account. They decide what to
        upload and who may see it. For their events, they are the data fiduciary and we act on their instructions.
      </li>
      <li>
        <strong>Guests</strong> — people who attended an event and received a link. They have no account. They may
        submit a selfie so we can find them in the photos.
      </li>
    </ul>

    <h2>What we collect</h2>

    <h3>If you have an account</h3>
    <ul>
      <li>Your name and email address.</li>
      <li>
        Your password, stored only as a bcrypt hash. We cannot read it, and we cannot tell you what it is if you forget
        it — we can only help you set a new one.
      </li>
      <li>
        Session records so you stay signed in: a hashed session token, the broad device type and operating system, and
        an expiry.
      </li>
      <li>Your organisation's name, plan, and how much storage and how many events it is using.</li>
    </ul>

    <h3>If you are a guest</h3>
    <ul>
      <li>The email address you gave the organiser, so we can send you your gallery link.</li>
      <li>
        The selfie you submit, and a <strong>facial recognition template</strong> derived from it — a numeric
        representation of facial geometry used to match you to photos. This is biometric data. See below.
      </li>
      <li>Whether the match succeeded, and when your gallery link was sent and opened.</li>
    </ul>

    <h3>Photos and videos</h3>
    <p>
      Files uploaded by organisers, together with any information already embedded in them by the camera — the capture
      time, camera and lens, and, where the photographer's device recorded it, GPS coordinates. We do not add location
      data; we read what is already there so that photos can be shown on a map to the organiser.
    </p>
    <p>
      We also detect faces in uploaded photos and group them into clusters. A cluster is not an identification: it is
      "these appear to be the same person". It only becomes a name if an organiser types one.
    </p>

    <h2>Facial recognition, specifically</h2>
    <p>
      This is the part of EventLens that most deserves your attention, so we will not bury it.
    </p>
    <ul>
      <li>
        <strong>What we compute.</strong> For each detected face we generate a mathematical template. It is not a
        picture and cannot be turned back into one, but it is biometric data and we treat it as sensitive.
      </li>
      <li>
        <strong>Why.</strong> Solely to match guests to their own photos and to group faces within a single event.
      </li>
      <li>
        <strong>Scope.</strong> Templates are scoped to the event they came from. We do not maintain a cross-event or
        cross-organisation face database, and we do not use your face to identify you at somebody else's event.
      </li>
      <li>
        <strong>We do not sell it, and we do not train models on it.</strong> Your face is not training data and is
        never shared with advertisers or data brokers.
      </li>
      <li>
        <strong>Selfies are deleted 30 days after the event ends</strong>, automatically. The selfie is only needed to
        perform the match; keeping it afterwards would be holding a photograph of someone for no reason.
      </li>
    </ul>

    <h2>How we protect it</h2>
    <p>Concretely, rather than in the abstract:</p>
    <ul>
      <li><strong>In transit:</strong> HTTPS throughout.</li>
      <li>
        <strong>Passwords:</strong> bcrypt hashes only. A breach of our database does not yield anyone's password.
      </li>
      <li>
        <strong>Tokens:</strong> session tokens, gallery links and password reset links are stored as SHA-256 hashes,
        never in their usable form. Someone reading our database could not use them to sign in as you or open your
        gallery.
      </li>
      <li>
        <strong>Third-party credentials:</strong> where you connect Google Drive or OneDrive, the access tokens are
        encrypted at rest with AES-256-GCM under a separate key.
      </li>
      <li>
        <strong>Access separation:</strong> our own administrators can manage organisations — plans, limits,
        suspension — but the platform does not give them a route into an organisation's photos, people or guests. If an
        administrator resets an organisation's password, the new credential goes to the account holder's inbox and is
        never shown to the administrator, so signing in as a customer is a separate and visible act rather than a
        silent one.
      </li>
      <li>
        <strong>Audit trail:</strong> security-relevant actions — password resets, organisation and event changes — are
        logged with who did them, and those logs are retained indefinitely.
      </li>
      <li>
        <strong>Guest links are unguessable</strong> and specific to one person. Anyone holding the link can see that
        gallery, which is why we ask guests not to forward them.
      </li>
    </ul>
    <p>
      No system is perfectly secure, and we will not claim otherwise. If a breach affects your personal data we will
      notify you and the Data Protection Board of India as required under the Digital Personal Data Protection Act,
      2023.
    </p>

    <h2>How long we keep things</h2>
    <table>
      <thead>
        <tr><th>Data</th><th>Retained</th></tr>
      </thead>
      <tbody>
        <tr><td>Guest selfies and their facial templates</td><td>30 days after the event ends, then deleted automatically</td></tr>
        <tr>
          <td>Event photos and videos</td>
          <td>
            Until the organiser deletes the event or its expiry passes. Deleting an event removes the media from our
            storage immediately and permanently — it cannot be undone or recovered
          </td>
        </tr>
        <tr><td>Individually deleted photos</td><td>Removed after a 7-day grace period</td></tr>
        <tr><td>Account and organisation records</td><td>For as long as the account is open</td></tr>
        <tr><td>Security and audit logs</td><td>Indefinitely, so that "who did this, and when" stays answerable</td></tr>
        <tr><td>Operational logs</td><td>30 days or less</td></tr>
      </tbody>
    </table>

    <h2>Who else touches your data</h2>
    <p>
      We do not sell personal data. We share it only with the providers needed to run the service, each of which
      processes it on our instructions:
    </p>
    <ul>
      <li><strong>Cloudflare R2</strong> — stores photos, videos and thumbnails.</li>
      <li><strong>Resend, or an SMTP provider we configure</strong> — delivers gallery links and account emails.</li>
      <li>
        <strong>JarvisLabs</strong> — supplies the GPU capacity used for face detection and matching. These machines
        are started and stopped on demand, and their use is logged.
      </li>
      <li>
        <strong>Google Drive and Microsoft OneDrive</strong> — only if an organiser connects one to import photos. We
        request read-only access, we do not modify anything in your drive, and the connection can be removed at any
        time.
      </li>
    </ul>
    <p>
      We may also disclose data where the law requires it, or to establish or defend a legal claim. Where the law
      permits, we will tell you first.
    </p>
    <h3>Where your data is held</h3>
    <p>
      EventLens is operated from India, but the providers above run in different regions, so your data may be stored or
      processed in <strong>India, Singapore or the United States</strong> depending on the service handling it. Photos
      and videos, email delivery and GPU processing may each sit in a different one of those locations.
    </p>
    <p>
      Where data leaves India, we rely on contractual protections with each provider requiring them to process it only
      on our instructions and to maintain appropriate security. We do not transfer personal data to any country the
      Central Government has restricted under section 16 of the Digital Personal Data Protection Act, 2023.
    </p>

    <h2>Your rights</h2>
    <p>Under the Digital Personal Data Protection Act, 2023, you may:</p>
    <ul>
      <li>Ask what personal data we hold about you and get a copy.</li>
      <li>Have inaccurate data corrected, or incomplete data completed.</li>
      <li>Have your data erased where we no longer need it.</li>
      <li>Withdraw consent you previously gave — for facial matching, this means asking for your selfie and template to be deleted.</li>
      <li>Nominate someone to exercise these rights if you are unable to.</li>
      <li>Complain to us, and then to the Data Protection Board of India if we do not resolve it.</li>
    </ul>
    <p>
      Write to <a href="mailto:info@touchmarkdes.com">info@touchmarkdes.com</a>. We will respond within 30 days.
    </p>
    <p>
      <strong>One limit worth being honest about.</strong> If you are a guest, the photos you appear in belong to the
      organiser who took them, and we host them on that organiser's behalf. We can delete your selfie, your facial
      template and your gallery link — and we will, on request. Removing the underlying photographs is the organiser's
      decision, and we will pass your request on and tell you who they are.
    </p>

    <h2>Children</h2>
    <p>
      EventLens is not intended for children under 18, and accounts may not be created by them. Children do appear in
      event photographs — at weddings, school events and family celebrations — and we do not perform facial matching
      for anyone who has not submitted their own selfie. Where we know a guest is a child, we require verifiable
      parental consent before processing their selfie, and we do not use their data for tracking or advertising of any
      kind.
    </p>

    <h2>Cookies</h2>
    <p>
      We use one essential cookie to keep you signed in. It is not used for advertising and not shared. We do not run
      third-party advertising or cross-site tracking on EventLens.
    </p>

    <h2>Changes</h2>
    <p>
      If we change this policy in a way that materially affects you, we will say so in the application and by email
      before it takes effect. The date at the top always reflects the current version.
    </p>

    <h2>Grievance Officer</h2>
    <p>
      If you are unhappy with how we have handled your personal data or your request about it, you can raise it
      directly with our Grievance Officer:
    </p>
    <p>
      <strong>Bharathiraja Thangappalam</strong><br />
      Director &amp; Chief Executive Officer<br />
      Touchmark Descience Pvt. Ltd<br />
      Tamarai Tech Park (Level 5), S.P. Plot No. 16-19 &amp; 20-A,<br />
      Thiru Vi Ka Industrial Estate, Guindy, Chennai, Tamil Nadu 600032, India<br />
      <a href="mailto:info@touchmarkdes.com">info@touchmarkdes.com</a> · +91 44 4065 2648
    </p>
    <p>
      We will acknowledge your complaint and respond within 30 days. If you are not satisfied with our response, you
      may complain to the Data Protection Board of India.
    </p>
  </div>
</div>

<style>
  /* Scoped so these generous defaults cannot leak into the app shell, which
     has much denser typography. */
  .legal :global(h2) {
    margin-top: 2.5rem;
    margin-bottom: 0.75rem;
    font-size: 1.35rem;
    font-weight: 600;
  }
  .legal :global(h3) {
    margin-top: 1.75rem;
    margin-bottom: 0.5rem;
    font-size: 1.05rem;
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
  .legal :global(table) {
    width: 100%;
    margin-bottom: 1.25rem;
    border-collapse: collapse;
    font-size: 0.925rem;
  }
  .legal :global(th),
  .legal :global(td) {
    border-bottom: 1px solid rgb(156 163 175 / 0.3);
    padding: 0.6rem 0.5rem;
    text-align: start;
    vertical-align: top;
  }
  /* Unmissable on the page, so an unfilled placeholder cannot be published by
     accident. */
  .legal :global(.note) {
    border-inline-start: 3px solid rgb(245 158 11);
    background: rgb(245 158 11 / 0.08);
    padding: 0.75rem 1rem;
    font-size: 0.9rem;
  }
</style>

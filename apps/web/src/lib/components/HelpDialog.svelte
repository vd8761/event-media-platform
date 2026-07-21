<script lang="ts">
  // Support request form, built on @immich/ui's Modal the same way Immich's
  // own dialogs are. One component serves both callers: the organiser variant
  // has a session behind it and only needs a message, while the public variant
  // additionally asks for a name and email — both optional, because a guest who
  // cannot reach their gallery should not have to identify themselves to say so.
  import { api } from '$lib/api';
  import { Alert, Button, Field, Modal, ModalBody, ModalFooter, Textarea, Input } from '@immich/ui';

  interface Props {
    variant?: 'organization' | 'public';
    // Organisation id — required for the organiser variant.
    orgId?: string;
    // Event the public form was opened from, so the ticket lands with context.
    eventId?: string;
    onClose: () => void;
  }

  let { variant = 'organization', orgId, eventId, onClose }: Props = $props();

  let message = $state('');
  let name = $state('');
  let email = $state('');
  let submitting = $state(false);
  let sent = $state(false);
  let error = $state('');

  const canSubmit = $derived(message.trim().length > 0 && !submitting);

  async function submit() {
    if (!canSubmit) return;
    submitting = true;
    error = '';
    try {
      if (variant === 'public') {
        await api.public.submitSupport({
          message: message.trim(),
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          eventId,
        });
      } else if (orgId) {
        await api.orgs.submitSupport(orgId, message.trim());
      } else {
        throw new Error('No organisation is linked to this account.');
      }
      sent = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Could not send your message.';
    } finally {
      submitting = false;
    }
  }
</script>

<Modal title="Help" size="small" {onClose}>
  <ModalBody>
    {#if sent}
      <Alert color="success" title="Message sent">
        Thanks — we have your message and will get back to you
        {#if variant === 'public' && !email.trim()}
          if you left us a way to reach you.
        {:else}
          by email.
        {/if}
      </Alert>
    {:else}
      <div class="flex flex-col gap-4">
        <p class="md-body-medium text-gray-500">
          Tell us what you need help with and we'll get back to you.
        </p>

        {#if variant === 'public'}
          <Field label="Your name" description="Optional">
            <Input bind:value={name} placeholder="Jane Doe" />
          </Field>
          <Field label="Your email" description="Optional — but we can only reply if you leave it">
            <Input bind:value={email} type="email" placeholder="jane@example.com" />
          </Field>
        {/if}

        <Field label="How can we help?" required>
          <Textarea bind:value={message} rows={6} placeholder="Describe the problem or question…" />
        </Field>

        {#if error}
          <Alert color="danger" title="Could not send">{error}</Alert>
        {/if}
      </div>
    {/if}
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full gap-2">
      <Button shape="round" color="secondary" fullWidth onclick={onClose}>
        {sent ? 'Close' : 'Cancel'}
      </Button>
      {#if !sent}
        <Button shape="round" fullWidth disabled={!canSubmit} loading={submitting} onclick={submit}>Send</Button>
      {/if}
    </div>
  </ModalFooter>
</Modal>

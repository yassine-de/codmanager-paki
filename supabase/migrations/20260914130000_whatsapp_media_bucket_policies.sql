-- The "whatsapp-media" storage bucket referenced by WhatsappInbox.tsx's
-- uploadAndSend() (image/document/audio attachments sent to customers) was
-- never actually created, causing "Bucket not found" on every attempt.
-- Bucket itself was created live via the Storage API (public, 50MB limit —
-- the project's global storage cap); this migration adds the RLS policies
-- storage.objects needs, mirroring the existing "sourcing-images" bucket's
-- policies but scoped to staff (WhatsApp Inbox is a staff-only page).

CREATE POLICY "Staff upload whatsapp media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'whatsapp-media' AND public.is_staff(auth.uid()));

CREATE POLICY "Public read whatsapp media"
ON storage.objects FOR SELECT
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Staff delete own whatsapp media"
ON storage.objects FOR DELETE
USING (bucket_id = 'whatsapp-media' AND owner = auth.uid());

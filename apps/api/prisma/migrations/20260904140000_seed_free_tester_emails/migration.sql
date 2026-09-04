-- Popula a lista de testadores gratuitos direto no deploy, sem depender de alguem colar os
-- e-mails na tela do admin (que ainda nao tinha acontecido enquanto pessoas reais - Vander,
-- Luiz Felipe - ja estavam tentando assinar de verdade e caindo no fluxo pago por engano).
-- ON CONFLICT DO NOTHING: seguro de rodar mesmo se algum desses e-mails ja tiver sido
-- adicionado manualmente entretanto.
INSERT INTO "FreeTesterEmail" ("id", "email", "note", "createdAt") VALUES
  (gen_random_uuid()::text, 'silvia.mendesleal@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'lamacedo1@yahoo.com.br', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'santosjonatan60093@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'luaradelfin@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'vanderdragon.souza1@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'marciocrod@yahoo.com.br', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'luiz89felipe@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'danicristinegomes@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'dudafccoelho@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'eliz1985@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'juliana.ob@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'lucy.donizete@yahoo.com.br', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'marianaassist@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'ridavino@gmail.com', 'Seed automatico 04/09', now()),
  (gen_random_uuid()::text, 'vanduarte2407@gmail.com', 'Seed automatico 04/09', now())
ON CONFLICT ("email") DO NOTHING;

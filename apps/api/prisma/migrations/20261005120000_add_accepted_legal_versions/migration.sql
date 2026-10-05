-- Versao juridica aceita no cadastro. Colunas opcionais: usuarios antigos ficam NULL (nao ha reaceite forcado).
ALTER TABLE "User" ADD COLUMN "acceptedTermsVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "acceptedPrivacyVersion" TEXT;

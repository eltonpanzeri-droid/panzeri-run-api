-- Foto de perfil do aluno: tabela nova e isolada (aditiva; nenhuma tabela existente e alterada).
CREATE TABLE "UserProfilePhoto" (
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfilePhoto_pkey" PRIMARY KEY ("userId")
);

-- CreateTable: Meus Tenis — Shoe nunca guarda km/numero de treinos acumulados (sempre derivado
-- em tempo de leitura a partir de ShoeUsage).
CREATE TABLE "Shoe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "nickname" TEXT,
    "photoUrl" TEXT,
    "startedUsingAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shoe_pkey" PRIMARY KEY ("id")
);

-- CreateTable: vinculo tenis <-> atividade (chave pela WorkoutCompletion, no maximo 1 por
-- execucao — trocar de tenis atualiza esta linha, nao empilha).
CREATE TABLE "ShoeUsage" (
    "id" TEXT NOT NULL,
    "shoeId" TEXT NOT NULL,
    "workoutCompletionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shoe_userId_status_idx" ON "Shoe"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShoeUsage_workoutCompletionId_key" ON "ShoeUsage"("workoutCompletionId");

-- CreateIndex
CREATE INDEX "ShoeUsage_shoeId_idx" ON "ShoeUsage"("shoeId");

-- CreateIndex
CREATE INDEX "ShoeUsage_userId_idx" ON "ShoeUsage"("userId");

-- AddForeignKey
ALTER TABLE "Shoe" ADD CONSTRAINT "Shoe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoeUsage" ADD CONSTRAINT "ShoeUsage_shoeId_fkey" FOREIGN KEY ("shoeId") REFERENCES "Shoe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoeUsage" ADD CONSTRAINT "ShoeUsage_workoutCompletionId_fkey" FOREIGN KEY ("workoutCompletionId") REFERENCES "WorkoutCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

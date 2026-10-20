-- Lote 2 Zepp (20/10/2026): identificador INTEIRO e estavel de cada treino publicado na Workout API V2 da Zepp (`workoutId` precisa ser inteiro, unico dentro da
-- plataforma). Somente uma sequence; nenhuma tabela ou coluna nova (o id fica em WorkoutDelivery.externalWorkoutId). Reversivel: DROP SEQUENCE "zepp_workout_id_seq".
CREATE SEQUENCE IF NOT EXISTS "zepp_workout_id_seq" AS INTEGER START WITH 100000 INCREMENT BY 1 MINVALUE 100000 MAXVALUE 2147483647 NO CYCLE;

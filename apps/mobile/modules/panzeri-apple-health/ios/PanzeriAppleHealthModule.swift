import ExpoModulesCore
import HealthKit
import WorkoutKit

// Apple Watch via HealthKit + WorkoutKit, isolado neste modulo. As funcoes daqui so' leem/agendam NO aparelho; o envio de treinos lidos para a API
// (sincronizacao com o Panzeri Run) e' feito pelo app, com autorizacao do usuario.
//
// HealthKit: so' LEITURA de HKWorkout (corrida) e da distancia andada/corrida. Nada e' escrito no Saude.
// WorkoutKit: agenda UM treino de corrida simples (distancia definida) no app Treino do Apple Watch,
// com o identificador do Panzeri Run (UUID) preservado em WorkoutPlan.id.
public class PanzeriAppleHealthModule: Module {
  private let healthStore = HKHealthStore()

  private var readTypes: Set<HKObjectType> {
    [HKObjectType.workoutType(), HKQuantityType(.distanceWalkingRunning)]
  }

  public func definition() -> ModuleDefinition {
    Name("PanzeriAppleHealth")

    // --- HealthKit ---------------------------------------------------------------------------

    Function("isHealthDataAvailable") { () -> Bool in
      HKHealthStore.isHealthDataAvailable()
    }

    // "shouldRequest" = o iOS ainda vai mostrar a folha de permissao; "unnecessary" = ja foi respondida.
    AsyncFunction("getHealthAuthorizationRequestStatus") { (promise: Promise) in
      self.healthStore.getRequestStatusForAuthorization(toShare: [], read: self.readTypes) { status, error in
        if let error = error {
          promise.reject("E_HEALTH_STATUS", error.localizedDescription)
          return
        }
        switch status {
        case .shouldRequest: promise.resolve("shouldRequest")
        case .unnecessary: promise.resolve("unnecessary")
        default: promise.resolve("unknown")
        }
      }
    }

    // Pede somente leitura de treinos e distancia. O iOS nunca informa se a leitura foi negada
    // (privacidade): negar e' indistinguivel de "nao ha dados" — por isso a prova real e' ler um treino.
    AsyncFunction("requestHealthAuthorization") { (promise: Promise) in
      Task {
        do {
          try await self.healthStore.requestAuthorization(toShare: [], read: self.readTypes)
          promise.resolve(["requested": true])
        } catch {
          promise.reject("E_HEALTH_AUTH", error.localizedDescription)
        }
      }
    }

    AsyncFunction("readRecentRunningWorkouts") { (limit: Int, promise: Promise) in
      let predicate = HKQuery.predicateForWorkouts(with: .running)
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(
        sampleType: HKObjectType.workoutType(),
        predicate: predicate,
        limit: max(1, min(limit, 20)),
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error = error {
          promise.reject("E_HEALTH_QUERY", error.localizedDescription)
          return
        }
        let workouts = (samples as? [HKWorkout]) ?? []
        Task {
          let formatter = ISO8601DateFormatter()
          var items: [[String: Any]] = []
          for workout in workouts {
            let distanceMeters = workout
              .statistics(for: HKQuantityType(.distanceWalkingRunning))?
              .sumQuantity()?
              .doubleValue(for: .meter())
            // Round trip futuro: se o treino foi executado a partir de um plano agendado por nos,
            // workoutPlan.id devolve o UUID do Panzeri Run. Nulo para treinos iniciados no relogio.
            let plan = try? await workout.workoutPlan
            items.append([
              "uuid": workout.uuid.uuidString,
              "sourceName": workout.sourceRevision.source.name,
              "sourceBundleId": workout.sourceRevision.source.bundleIdentifier,
              "sourceProductType": Self.orNull(workout.sourceRevision.productType),
              "deviceName": Self.orNull(workout.device?.name),
              "deviceManufacturer": Self.orNull(workout.device?.manufacturer),
              "deviceModel": Self.orNull(workout.device?.model),
              "deviceHardwareVersion": Self.orNull(workout.device?.hardwareVersion),
              "deviceSoftwareVersion": Self.orNull(workout.device?.softwareVersion),
              "activityType": workout.workoutActivityType == .running ? "running" : "other",
              "activityTypeRaw": Int(workout.workoutActivityType.rawValue),
              "isIndoor": Self.orNull(workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool),
              "timeZone": Self.orNull(workout.metadata?[HKMetadataKeyTimeZone] as? String),
              "startDate": formatter.string(from: workout.startDate),
              "endDate": formatter.string(from: workout.endDate),
              "durationSeconds": workout.duration,
              "distanceMeters": Self.orNull(distanceMeters),
              "workoutPlanId": Self.orNull(plan?.id.uuidString)
            ])
          }
          promise.resolve(items)
        }
      }
      self.healthStore.execute(query)
    }

    // --- WorkoutKit --------------------------------------------------------------------------

    // Devolve authorized | denied | notDetermined | restricted. Chamar de novo e' seguro (so' mostra a folha uma vez).
    AsyncFunction("requestWorkoutAuthorization") { (promise: Promise) in
      Task {
        let state = await WorkoutScheduler.shared.requestAuthorization()
        promise.resolve(Self.describe(state))
      }
    }

    // Agenda UMA corrida continua com distancia definida. planId precisa ser um UUID (WorkoutPlan.id).
    AsyncFunction("scheduleRunWorkout") { (planId: String, distanceKm: Double, startIso: String, promise: Promise) in
      guard let uuid = UUID(uuidString: planId) else {
        promise.reject("E_INVALID_PLAN_ID", "planId precisa ser um UUID.")
        return
      }
      guard distanceKm > 0, distanceKm <= 100 else {
        promise.reject("E_INVALID_DISTANCE", "Distancia fora do intervalo aceito (0 a 100 km).")
        return
      }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let start = formatter.date(from: startIso) ?? ISO8601DateFormatter().date(from: startIso) else {
        promise.reject("E_INVALID_DATE", "Data invalida (use ISO 8601).")
        return
      }
      let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: start)

      Task {
        let state = await WorkoutScheduler.shared.requestAuthorization()
        guard state == .authorized else {
          promise.reject("E_NOT_AUTHORIZED", "WorkoutKit nao autorizado (estado: \(Self.describe(state))).")
          return
        }
        let workout = SingleGoalWorkout(
          activity: .running,
          location: .outdoor,
          goal: .distance(distanceKm, .kilometers)
        )
        let plan = WorkoutPlan(.goal(workout), id: uuid)
        await WorkoutScheduler.shared.schedule(plan, at: components)
        promise.resolve([
          "scheduled": true,
          "planId": uuid.uuidString,
          "distanceKm": distanceKm,
          "scheduledFor": formatter.string(from: start)
        ])
      }
    }

    // Agenda um CustomWorkout construido a partir do AppleCustomWorkoutSpec ja' validado pela API (Etapa 7). Usa o MESMO builder da sonda
    // (CustomWorkoutSpecBuilder.construct): spec invalido NAO agenda e devolve os erros identificaveis. planId (UUID) vira WorkoutPlan.id — a
    // identidade estavel da entrega, devolvida depois pelo HealthKit. Falha de autorizacao/agendamento rejeita com o erro real (codigo + mensagem).
    AsyncFunction("scheduleCustomWorkoutSpec") { (planId: String, specJson: String, startIso: String, promise: Promise) in
      guard let uuid = UUID(uuidString: planId) else {
        promise.reject("E_INVALID_PLAN_ID", "planId precisa ser um UUID.")
        return
      }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let start = formatter.date(from: startIso) ?? ISO8601DateFormatter().date(from: startIso) else {
        promise.reject("E_INVALID_DATE", "Data invalida (use ISO 8601).")
        return
      }
      let construction = CustomWorkoutSpecBuilder.construct(specJson: specJson)
      guard let workout = construction.workout else {
        // Spec invalido: nada e' agendado; os erros estruturados voltam para o app registrar e mostrar.
        promise.resolve(["scheduled": false, "planId": uuid.uuidString, "errors": construction.result["errors"] ?? [[String: Any]]()])
        return
      }
      let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: start)

      Task {
        let state = await WorkoutScheduler.shared.requestAuthorization()
        guard state == .authorized else {
          promise.reject("E_NOT_AUTHORIZED", "WorkoutKit nao autorizado (estado: \(Self.describe(state))).")
          return
        }
        let plan = WorkoutPlan(.custom(workout), id: uuid)
        await WorkoutScheduler.shared.schedule(plan, at: components)
        promise.resolve([
          "scheduled": true,
          "planId": uuid.uuidString,
          "scheduledFor": formatter.string(from: start)
        ])
      }
    }

    // Constroi e VALIDA (sem agendar) um CustomWorkout a partir do AppleCustomWorkoutSpec ja' validado pela API. Traducao mecanica: ver
    // CustomWorkoutSpecBuilder.swift. Devolve { valid, errors[{code,message,path}], summary? } — rejeicoes sao identificaveis, nunca genericas.
    Function("validateCustomWorkoutSpec") { (specJson: String) -> [String: Any] in
      CustomWorkoutSpecBuilder.validate(specJson: specJson)
    }

    // Treinos agendados por ESTE app (WorkoutKit so' mostra os do proprio app).
    AsyncFunction("listScheduledWorkouts") { (promise: Promise) in
      Task {
        let scheduled = await WorkoutScheduler.shared.scheduledWorkouts
        let formatter = ISO8601DateFormatter()
        let items: [[String: Any]] = scheduled.map { item in
          let date = Calendar.current.date(from: item.date)
          return [
            "planId": item.plan.id.uuidString,
            "date": Self.orNull(date.map { formatter.string(from: $0) }),
            "complete": item.complete
          ]
        }
        promise.resolve(items)
      }
    }

    // Limpeza entre testes: remove apenas os treinos agendados por este app.
    AsyncFunction("removeAllScheduledWorkouts") { (promise: Promise) in
      Task {
        await WorkoutScheduler.shared.removeAllWorkouts()
        promise.resolve(["removed": true])
      }
    }
  }

  // Optional -> valor serializavel (nulo vira NSNull, nunca zero: ausencia continua ausencia).
  private static func orNull(_ value: Any?) -> Any {
    value ?? NSNull()
  }

  private static func describe(_ state: WorkoutScheduler.AuthorizationState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }
}

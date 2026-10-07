import Foundation
import HealthKit
import WorkoutKit

// Ponte AppleCustomWorkoutSpec -> WorkoutKit CustomWorkout. O spec ja vem validado pela API (tradutor Apple) e este arquivo SO' traduz de forma
// mecanica; nao reinterpreta a TrainingSession nem toma decisao de prescricao:
//   activity "running" -> .running      location "outdoor" -> .outdoor
//   cada bloco -> IntervalBlock         iterations -> iterations
//   purpose work/recovery -> IntervalStep.Purpose.work/.recovery
//   goal distance (metros) -> WorkoutGoal.distance(m, .meters)
//   warmup/cooldown -> nil (nunca inferidos)        alerts -> nenhum (sem pace/velocidade nesta etapa)
// Antes de aceitar o spec usa as verificacoes oficiais do WorkoutKit (CustomWorkout.supportsActivity / supportsGoal) e tenta serializar o
// WorkoutPlan. NADA e' agendado aqui. Qualquer rejeicao devolve codigo, caminho e mensagem identificaveis (nunca uma mensagem generica unica).

struct CustomWorkoutSpecIssue {
  let code: String
  let message: String
  let path: String

  var dictionary: [String: Any] { ["code": code, "message": message, "path": path] }
}

private struct SpecGoal: Decodable {
  let type: String
  let meters: Double
}

private struct SpecStep: Decodable {
  let purpose: String
  let goal: SpecGoal
}

private struct SpecBlock: Decodable {
  let iterations: Int
  let steps: [SpecStep]
}

// warmup/cooldown precisam ser null: qualquer valor presente e' recusado (o Panzeri Run nao tem aquecimento/desaquecimento estruturados).
private struct SpecPlaceholder: Decodable {}

private struct CustomWorkoutSpec: Decodable {
  let specVersion: Int
  let activity: String
  let location: String
  let warmup: SpecPlaceholder?
  let cooldown: SpecPlaceholder?
  let blocks: [SpecBlock]
}

enum CustomWorkoutSpecBuilder {
  static let supportedSpecVersion = 1

  // Valida e constroi. Devolve sempre um dicionario serializavel: { valid, errors[{code,message,path}], summary? }.
  static func validate(specJson: String) -> [String: Any] {
    guard let data = specJson.data(using: .utf8) else {
      return invalid([CustomWorkoutSpecIssue(code: "E_SPEC_INVALID_JSON", message: "O spec nao e texto UTF-8 valido.", path: "")])
    }
    let spec: CustomWorkoutSpec
    do {
      spec = try JSONDecoder().decode(CustomWorkoutSpec.self, from: data)
    } catch {
      return invalid([CustomWorkoutSpecIssue(code: "E_SPEC_INVALID_JSON", message: "Spec ilegivel: \(String(describing: error))", path: "")])
    }

    var issues: [CustomWorkoutSpecIssue] = []
    func issue(_ code: String, _ message: String, _ path: String) {
      issues.append(CustomWorkoutSpecIssue(code: code, message: message, path: path))
    }

    if spec.specVersion != supportedSpecVersion {
      issue("E_SPEC_UNSUPPORTED_VERSION", "Versao de spec \(spec.specVersion) nao suportada (esperada \(supportedSpecVersion)).", "specVersion")
    }
    if spec.activity != "running" {
      issue("E_SPEC_UNSUPPORTED_ACTIVITY", "Atividade \"\(spec.activity)\" nao suportada (apenas running).", "activity")
    }
    if spec.location != "outdoor" {
      issue("E_SPEC_UNSUPPORTED_LOCATION", "Local \"\(spec.location)\" nao suportado (apenas outdoor).", "location")
    }
    if spec.warmup != nil || spec.cooldown != nil {
      issue("E_SPEC_WARMUP_COOLDOWN_NOT_SUPPORTED", "warmup/cooldown devem ser null: nao sao inferidos.", spec.warmup != nil ? "warmup" : "cooldown")
    }
    if spec.blocks.isEmpty {
      issue("E_SPEC_EMPTY_BLOCKS", "O spec nao tem nenhum bloco.", "blocks")
    }
    if !CustomWorkout.supportsActivity(.running) {
      issue("E_WORKOUTKIT_ACTIVITY_UNSUPPORTED", "O sistema nao suporta CustomWorkout para corrida neste aparelho.", "activity")
    }

    var blocks: [IntervalBlock] = []
    for (blockIndex, block) in spec.blocks.enumerated() {
      let blockPath = "blocks[\(blockIndex)]"
      var blockIsValid = true
      if block.iterations < 1 {
        issue("E_SPEC_INVALID_ITERATIONS", "iterations precisa ser inteiro >= 1 (recebido \(block.iterations)).", "\(blockPath).iterations")
        blockIsValid = false
      }
      if block.steps.isEmpty {
        issue("E_SPEC_EMPTY_STEPS", "O bloco nao tem passos.", "\(blockPath).steps")
        blockIsValid = false
      }

      var steps: [IntervalStep] = []
      for (stepIndex, step) in block.steps.enumerated() {
        let stepPath = "\(blockPath).steps[\(stepIndex)]"
        let purpose: IntervalStep.Purpose
        switch step.purpose {
        case "work": purpose = .work
        case "recovery": purpose = .recovery
        default:
          issue("E_SPEC_INVALID_PURPOSE", "purpose \"\(step.purpose)\" invalido (work ou recovery).", "\(stepPath).purpose")
          blockIsValid = false
          continue
        }
        guard step.goal.type == "distance" else {
          issue("E_SPEC_UNSUPPORTED_GOAL", "Meta \"\(step.goal.type)\" nao suportada (apenas distance).", "\(stepPath).goal.type")
          blockIsValid = false
          continue
        }
        guard step.goal.meters.isFinite, step.goal.meters > 0 else {
          issue("E_SPEC_INVALID_DISTANCE", "Distancia invalida (\(step.goal.meters) m).", "\(stepPath).goal.meters")
          blockIsValid = false
          continue
        }
        let goal = WorkoutGoal.distance(step.goal.meters, .meters)
        if !CustomWorkout.supportsGoal(goal, activity: .running, location: .outdoor) {
          issue("E_WORKOUTKIT_GOAL_UNSUPPORTED", "O sistema nao suporta a meta de \(step.goal.meters) m para corrida ao ar livre.", "\(stepPath).goal")
          blockIsValid = false
          continue
        }
        steps.append(IntervalStep(purpose, goal: goal, alert: nil))
      }
      if blockIsValid {
        blocks.append(IntervalBlock(steps: steps, iterations: block.iterations))
      }
    }

    guard issues.isEmpty else { return invalid(issues) }

    let workout = CustomWorkout(activity: .running, location: .outdoor, displayName: nil, warmup: nil, blocks: blocks, cooldown: nil)

    // Eco do que foi construido (lido de volta do proprio CustomWorkout) para o JS conferir que a traducao foi mecanica e exata.
    var totalMeters = 0.0
    let echoBlocks: [[String: Any]] = workout.blocks.map { (block: IntervalBlock) -> [String: Any] in
      let echoSteps: [[String: Any]] = block.steps.map { (step: IntervalStep) -> [String: Any] in
        var meters = 0.0
        if case .distance(let value, let unit) = step.step.goal {
          meters = Measurement(value: value, unit: unit).converted(to: .meters).value
        }
        totalMeters += meters * Double(block.iterations)
        return ["purpose": step.purpose == .work ? "work" : "recovery", "meters": meters]
      }
      return ["iterations": block.iterations, "steps": echoSteps]
    }

    // Serializacao do plano (nao depende de Apple Watch): se o WorkoutKit nao conseguir representar a estrutura, aparece aqui.
    let plan = WorkoutPlan(.custom(workout), id: UUID())
    let serializedBytes: Int
    do {
      // dataRepresentation lanca erro: se o WorkoutKit nao conseguir serializar, o erro nativo real e' devolvido (nao engolido).
      serializedBytes = try plan.dataRepresentation.count
    } catch {
      return invalid([CustomWorkoutSpecIssue(code: "E_WORKOUTKIT_DATA_REPRESENTATION_FAILED", message: "O WorkoutKit nao serializou o plano: \(String(describing: error))", path: "")])
    }
    if serializedBytes == 0 {
      return invalid([CustomWorkoutSpecIssue(code: "E_WORKOUTKIT_DATA_REPRESENTATION_FAILED", message: "O WorkoutKit nao serializou o plano (0 bytes).", path: "")])
    }

    return [
      "valid": true,
      "errors": [[String: Any]](),
      "summary": [
        "activity": "running",
        "location": "outdoor",
        "blocks": echoBlocks,
        "totalMeters": totalMeters,
        "serializedBytes": serializedBytes
      ] as [String: Any]
    ]
  }

  private static func invalid(_ issues: [CustomWorkoutSpecIssue]) -> [String: Any] {
    ["valid": false, "errors": issues.map { $0.dictionary }]
  }
}

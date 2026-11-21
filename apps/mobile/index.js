import { registerRootComponent } from 'expo';
import App from './App';
// Tarefa em segundo plano do Health Connect: precisa ser definida AQUI, no inicio do app, para existir tambem quando o Android a acorda sem abrir a tela.
import './src/healthConnect/backgroundTask';
// Tarefa de localizacao do Iniciar treino (so' roda enquanto ha treino em andamento): precisa ser definida aqui, no inicio, para existir quando o sistema acorda o aplicativo em segundo plano.
import './src/run/tracking';

registerRootComponent(App);

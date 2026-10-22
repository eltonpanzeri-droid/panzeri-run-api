import { registerRootComponent } from 'expo';
import App from './App';
// Tarefa em segundo plano do Health Connect: precisa ser definida AQUI, no inicio do app, para existir tambem quando o Android a acorda sem abrir a tela.
import './src/healthConnect/backgroundTask';

registerRootComponent(App);

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.panzerirun.wear"
    compileSdk = 34

    defaultConfig {
        // Mesmo identificador do app do celular (com.panzerirun.app): na Play, o app de relogio vai na MESMA ficha do Panzeri Run.
        applicationId = "com.panzerirun.app"
        minSdk = 30 // Wear OS 3 (Galaxy Watch 4 em diante)
        targetSdk = 34
        versionCode = 100002
        versionName = "0.2.0"
        // API de producao do Panzeri Run (a mesma do app do celular). Troque por -Pwear.apiUrl=... para testar contra outro servidor.
        val apiUrl = (project.findProperty("wear.apiUrl") as String?) ?: "https://agenteselton-panzeri-run-api.hbljgk.easypanel.host"
        buildConfigField("String", "API_URL", "\"$apiUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    implementation("androidx.wear.compose:compose-navigation:1.4.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.8.1")
    // Fase 3: gravar o treino pelo Health Services (sensores do relogio) e mostrar a atividade em andamento no mostrador.
    implementation("androidx.health:health-services-client:1.0.0")
    implementation("androidx.wear:wear-ongoing:1.0.0")
    implementation("androidx.concurrent:concurrent-futures-ktx:1.2.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

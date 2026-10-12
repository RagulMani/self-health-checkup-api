/**
 * Health calculations: BMI, per-metric status, daily wellness score and
 * critical-value alerts. Thresholds follow common adult reference ranges and
 * are informational only — they are not a diagnosis.
 */

export const MEDICAL_DISCLAIMER =
  "This information is for general informational purposes only and does not replace professional medical diagnosis, treatment, or emergency care. If you think you may have a medical emergency, call your local emergency number immediately.";

export type MetricStatus = "good" | "caution" | "alert";

export interface HealthMetrics {
  height_cm: number | null;
  weight_kg: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  body_temperature_c: number | null;
  blood_sugar_mgdl: number | null;
  blood_sugar_context: string | null;
  sleep_hours: number | null;
  water_intake_liters: number | null;
  activity_minutes: number | null;
}

export interface ScoreComponent {
  metric: string;
  label: string;
  score: number;
  status: MetricStatus;
  message: string;
}

export interface HealthAlert {
  metric: string;
  level: "caution" | "alert";
  message: string;
}

export function calculateBmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

export function bmiCategory(bmi: number | null): string | null {
  if (bmi === null) return null;
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Healthy weight";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

function statusFor(score: number): MetricStatus {
  if (score >= 80) return "good";
  if (score >= 50) return "caution";
  return "alert";
}

function component(metric: string, label: string, score: number, message: string): ScoreComponent {
  return { metric, label, score, status: statusFor(score), message };
}

export function scoreComponents(m: HealthMetrics): ScoreComponent[] {
  const out: ScoreComponent[] = [];

  const bmi = calculateBmi(m.height_cm, m.weight_kg);
  if (bmi !== null) {
    let s = 25;
    if (bmi >= 18.5 && bmi < 25) s = 100;
    else if ((bmi >= 25 && bmi < 30) || (bmi >= 17 && bmi < 18.5)) s = 70;
    else if (bmi >= 30 && bmi < 35) s = 45;
    out.push(component("bmi", "BMI", s, `BMI ${bmi} (${bmiCategory(bmi)})`));
  }

  if (m.systolic_bp !== null && m.diastolic_bp !== null) {
    const sys = m.systolic_bp;
    const dia = m.diastolic_bp;
    let s: number;
    let msg: string;
    if (sys >= 180 || dia >= 120) {
      s = 10;
      msg = "Blood pressure is in a crisis range";
    } else if (sys < 90 || dia < 60) {
      s = 55;
      msg = "Blood pressure is lower than typical";
    } else if (sys < 120 && dia < 80) {
      s = 100;
      msg = "Blood pressure is in the normal range";
    } else if (sys < 130 && dia < 80) {
      s = 85;
      msg = "Blood pressure is slightly elevated";
    } else if (sys < 140 && dia < 90) {
      s = 65;
      msg = "Blood pressure is high (stage 1 range)";
    } else {
      s = 35;
      msg = "Blood pressure is high (stage 2 range)";
    }
    out.push(component("blood_pressure", "Blood pressure", s, `${sys}/${dia} mmHg — ${msg}`));
  }

  if (m.heart_rate !== null) {
    const hr = m.heart_rate;
    let s = 35;
    if (hr >= 60 && hr <= 100) s = 100;
    else if ((hr >= 50 && hr < 60) || (hr > 100 && hr <= 110)) s = 70;
    out.push(component("heart_rate", "Heart rate", s, `${hr} bpm resting heart rate`));
  }

  if (m.body_temperature_c !== null) {
    const t = m.body_temperature_c;
    let s = 25;
    if (t >= 36.1 && t <= 37.2) s = 100;
    else if ((t > 37.2 && t <= 38.0) || (t >= 35.5 && t < 36.1)) s = 65;
    out.push(component("body_temperature", "Body temperature", s, `${t} °C`));
  }

  if (m.blood_sugar_mgdl !== null) {
    const g = m.blood_sugar_mgdl;
    const fasting = m.blood_sugar_context === "fasting" || m.blood_sugar_context === "before_meal";
    let s: number;
    if (g < 70) s = 40;
    else if (fasting) s = g < 100 ? 100 : g < 126 ? 65 : 30;
    else s = g < 140 ? 100 : g < 200 ? 65 : 30;
    out.push(
      component("blood_sugar", "Blood sugar", s, `${g} mg/dL${m.blood_sugar_context ? ` (${m.blood_sugar_context.replace("_", " ")})` : ""}`),
    );
  }

  if (m.sleep_hours !== null) {
    const h = m.sleep_hours;
    let s = 30;
    if (h >= 7 && h <= 9) s = 100;
    else if ((h >= 6 && h < 7) || (h > 9 && h <= 10)) s = 75;
    else if (h >= 5 && h < 6) s = 50;
    out.push(component("sleep", "Sleep", s, `${h} hours of sleep`));
  }

  if (m.water_intake_liters !== null) {
    const w = m.water_intake_liters;
    const s = w >= 2.5 ? 100 : w >= 2 ? 85 : w >= 1.5 ? 65 : w >= 1 ? 45 : 25;
    out.push(component("water", "Water intake", s, `${w} L of water`));
  }

  if (m.activity_minutes !== null) {
    const a = m.activity_minutes;
    const s = a >= 30 ? 100 : a >= 20 ? 80 : a >= 10 ? 60 : a > 0 ? 40 : 20;
    out.push(component("activity", "Physical activity", s, `${a} minutes of activity`));
  }

  return out;
}

export function wellnessScore(m: HealthMetrics): number | null {
  const parts = scoreComponents(m);
  if (parts.length === 0) return null;
  const mean = Math.round(parts.reduce((sum, p) => sum + p.score, 0) / parts.length);
  // A single dangerous reading must not be averaged away into a reassuring score.
  if (parts.some((p) => p.score <= 10)) return Math.min(mean, 45);
  if (parts.some((p) => p.status === "alert")) return Math.min(mean, 65);
  return mean;
}

export function wellnessLabel(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Needs attention";
}

export function healthAlerts(m: HealthMetrics): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  const sys = m.systolic_bp;
  const dia = m.diastolic_bp;
  if (sys !== null && dia !== null) {
    if (sys >= 180 || dia >= 120) {
      alerts.push({
        metric: "blood_pressure",
        level: "alert",
        message:
          "Blood pressure of 180/120 or higher can be a hypertensive crisis. If you also have chest pain, shortness of breath, back pain, numbness, weakness, vision changes or difficulty speaking, seek emergency care now.",
      });
    } else if (sys >= 140 || dia >= 90) {
      alerts.push({
        metric: "blood_pressure",
        level: "caution",
        message: "Your blood pressure reading is high. Recheck after resting and discuss repeated high readings with a doctor.",
      });
    } else if (sys < 90 || dia < 60) {
      alerts.push({
        metric: "blood_pressure",
        level: "caution",
        message: "Your blood pressure is low. If you feel dizzy, faint or confused, contact a doctor.",
      });
    }
  }
  if (m.heart_rate !== null) {
    if (m.heart_rate > 120 || m.heart_rate < 40) {
      alerts.push({
        metric: "heart_rate",
        level: "alert",
        message: "Your resting heart rate is far outside the typical range. Seek medical advice promptly, especially if you feel unwell.",
      });
    } else if (m.heart_rate > 100 || m.heart_rate < 50) {
      alerts.push({
        metric: "heart_rate",
        level: "caution",
        message: "Your resting heart rate is outside the typical 60–100 bpm range.",
      });
    }
  }
  if (m.body_temperature_c !== null) {
    if (m.body_temperature_c >= 39.4 || m.body_temperature_c < 35) {
      alerts.push({
        metric: "body_temperature",
        level: "alert",
        message: "Your temperature is in a range that needs prompt medical attention.",
      });
    } else if (m.body_temperature_c >= 38) {
      alerts.push({
        metric: "body_temperature",
        level: "caution",
        message: "You have a fever. Rest, drink fluids and contact a doctor if it lasts more than 3 days.",
      });
    }
  }
  if (m.blood_sugar_mgdl !== null) {
    if (m.blood_sugar_mgdl < 54 || m.blood_sugar_mgdl >= 300) {
      alerts.push({
        metric: "blood_sugar",
        level: "alert",
        message: "Your blood sugar is at a level that may be dangerous. Follow your care plan and seek medical help promptly.",
      });
    } else if (m.blood_sugar_mgdl < 70) {
      alerts.push({
        metric: "blood_sugar",
        level: "caution",
        message: "Your blood sugar is low. Have a fast-acting carbohydrate and recheck in 15 minutes.",
      });
    } else if (m.blood_sugar_mgdl >= 200) {
      alerts.push({
        metric: "blood_sugar",
        level: "caution",
        message: "Your blood sugar is high. Discuss repeated high readings with a doctor.",
      });
    }
  }
  return alerts;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rule-based symptom guidance. Produces general advice and an urgency level —
 * never a diagnosis. Red-flag symptoms always escalate to emergency.
 */
import { MEDICAL_DISCLAIMER } from "./health";

export const DURATIONS = ["less_than_24h", "1_3_days", "4_7_days", "1_2_weeks", "more_than_2_weeks"] as const;
export const SEVERITIES = ["mild", "moderate", "severe"] as const;
export const URGENCY_LEVELS = ["self_care", "monitor", "consult_doctor", "urgent_care", "emergency"] as const;

export type Duration = (typeof DURATIONS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export interface SymptomDefinition {
  id: string;
  label: string;
  category: string;
  weight: number;
  red_flag: boolean;
  /** Escalates to at least consult_doctor regardless of score. */
  needs_review: boolean;
  self_care: string[];
}

const S = (
  id: string,
  label: string,
  category: string,
  weight: number,
  self_care: string[] = [],
  opts: { red_flag?: boolean; needs_review?: boolean } = {},
): SymptomDefinition => ({
  id,
  label,
  category,
  weight,
  red_flag: opts.red_flag ?? false,
  needs_review: opts.needs_review ?? false,
  self_care,
});

const REST = "Get plenty of rest";
const FLUIDS = "Drink plenty of fluids to stay hydrated";

export const SYMPTOM_CATALOG: SymptomDefinition[] = [
  S("fever", "Fever", "General", 2, [REST, FLUIDS, "Wear light clothing and keep the room comfortably cool"]),
  S("high_fever", "High fever (above 39.4 °C / 103 °F)", "General", 4, [FLUIDS], { needs_review: true }),
  S("fatigue", "Fatigue or tiredness", "General", 1, [REST, "Keep a regular sleep schedule", "Eat balanced meals"]),
  S("body_aches", "Body aches", "General", 1, [REST, FLUIDS, "A warm bath may ease muscle aches"]),
  S("chills", "Chills", "General", 1, [REST, FLUIDS]),
  S("loss_of_appetite", "Loss of appetite", "General", 1, ["Eat small, frequent, light meals", FLUIDS]),
  S("unexplained_weight_loss", "Unexplained weight loss", "General", 3, [], { needs_review: true }),
  S("headache", "Headache", "Head & neurological", 1, [REST, FLUIDS, "Rest in a quiet, dark room", "Limit screen time"]),
  S("dizziness", "Dizziness", "Head & neurological", 2, ["Sit or lie down until it passes", FLUIDS, "Stand up slowly"]),
  S("sudden_severe_headache", "Sudden, severe 'worst ever' headache", "Head & neurological", 5, [], { red_flag: true }),
  S("confusion", "Confusion or trouble staying awake", "Head & neurological", 5, [], { red_flag: true }),
  S("fainting", "Fainting or loss of consciousness", "Head & neurological", 5, [], { red_flag: true }),
  S("face_arm_weakness", "Face drooping, arm weakness or numbness on one side", "Head & neurological", 5, [], { red_flag: true }),
  S("slurred_speech", "Slurred or difficult speech", "Head & neurological", 5, [], { red_flag: true }),
  S("seizure", "Seizure", "Head & neurological", 5, [], { red_flag: true }),
  S("sore_throat", "Sore throat", "Respiratory", 1, ["Gargle with warm salt water", "Drink warm fluids like tea with honey", REST]),
  S("runny_nose", "Runny or stuffy nose", "Respiratory", 1, ["Use saline nasal spray", FLUIDS, REST]),
  S("sneezing", "Sneezing", "Respiratory", 1, ["Avoid known allergens and dust"]),
  S("cough", "Cough", "Respiratory", 1, [FLUIDS, "Warm drinks with honey may soothe the throat", "Avoid smoke"]),
  S("persistent_cough", "Cough lasting more than 3 weeks", "Respiratory", 3, [], { needs_review: true }),
  S("wheezing", "Wheezing", "Respiratory", 3, ["Avoid smoke and known triggers"], { needs_review: true }),
  S("shortness_of_breath", "Severe shortness of breath or difficulty breathing", "Respiratory", 5, [], { red_flag: true }),
  S("coughing_blood", "Coughing up blood", "Respiratory", 5, [], { red_flag: true }),
  S("chest_pain", "Chest pain, pressure or tightness", "Heart & circulation", 5, [], { red_flag: true }),
  S("palpitations", "Racing or irregular heartbeat", "Heart & circulation", 3, ["Sit down and rest", "Avoid caffeine and alcohol"], { needs_review: true }),
  S("leg_swelling", "Swelling in legs or ankles", "Heart & circulation", 2, ["Elevate your legs when resting", "Reduce salt intake"], { needs_review: true }),
  S("nausea", "Nausea", "Digestive", 1, ["Sip clear fluids slowly", "Eat bland foods such as toast, rice or bananas"]),
  S("vomiting", "Vomiting", "Digestive", 2, ["Sip small amounts of water or oral rehydration solution", "Avoid solid food for a few hours"]),
  S("diarrhea", "Diarrhea", "Digestive", 2, ["Drink oral rehydration solution", "Eat bland foods", "Avoid dairy, fatty and spicy foods"]),
  S("abdominal_pain", "Mild abdominal pain", "Digestive", 2, ["Eat light meals", "A warm compress may help"]),
  S("severe_abdominal_pain", "Severe or worsening abdominal pain", "Digestive", 5, [], { red_flag: true }),
  S("blood_in_stool", "Blood in stool or black, tarry stool", "Digestive", 4, [], { needs_review: true }),
  S("heartburn", "Heartburn or acid reflux", "Digestive", 1, ["Avoid large meals close to bedtime", "Limit spicy and fatty foods"]),
  S("painful_urination", "Painful or burning urination", "Urinary", 2, [FLUIDS], { needs_review: true }),
  S("frequent_urination", "Frequent urination or excessive thirst", "Urinary", 2, [], { needs_review: true }),
  S("rash", "Skin rash", "Skin", 1, ["Keep the area clean and dry", "Avoid scratching", "Use fragrance-free moisturiser"]),
  S("itching", "Itching", "Skin", 1, ["Apply a cool compress", "Avoid harsh soaps"]),
  S("swelling_face_lips", "Swelling of face, lips or tongue", "Skin", 5, [], { red_flag: true }),
  S("back_pain", "Back pain", "Muscles & joints", 1, ["Keep gently active", "Apply heat or cold packs", "Mind your posture"]),
  S("joint_pain", "Joint pain", "Muscles & joints", 1, [REST, "Apply a cold pack to reduce swelling"]),
  S("muscle_cramps", "Muscle cramps", "Muscles & joints", 1, ["Stretch gently", FLUIDS]),
  S("ear_pain", "Ear pain", "Eyes & ears", 2, ["Apply a warm compress"]),
  S("eye_redness", "Red or irritated eyes", "Eyes & ears", 1, ["Avoid rubbing your eyes", "Rest your eyes from screens"]),
  S("vision_changes", "Sudden vision loss or changes", "Eyes & ears", 5, [], { red_flag: true }),
  S("insomnia", "Trouble sleeping", "Mental wellbeing", 1, ["Keep a consistent bedtime", "Avoid screens and caffeine before bed"]),
  S("anxiety", "Feeling anxious or stressed", "Mental wellbeing", 1, ["Try slow breathing exercises", "Take short walks", "Talk to someone you trust"]),
  S("low_mood", "Persistent low mood", "Mental wellbeing", 2, ["Stay connected with friends and family", "Keep a regular routine"], { needs_review: true }),
  S("self_harm_thoughts", "Thoughts of harming yourself", "Mental wellbeing", 5, [], { red_flag: true }),
  S("severe_bleeding", "Heavy bleeding that won't stop", "Injury", 5, [], { red_flag: true }),
];

const CATALOG_BY_ID = new Map(SYMPTOM_CATALOG.map((s) => [s.id, s]));

export function findSymptom(id: string): SymptomDefinition | undefined {
  return CATALOG_BY_ID.get(id);
}

const DURATION_FACTOR: Record<Duration, number> = {
  less_than_24h: 0,
  "1_3_days": 1,
  "4_7_days": 2,
  "1_2_weeks": 3,
  more_than_2_weeks: 4,
};

const SEVERITY_FACTOR: Record<Severity, number> = { mild: 0, moderate: 1, severe: 3 };

const URGENCY_RANK: Record<UrgencyLevel, number> = {
  self_care: 0,
  monitor: 1,
  consult_doctor: 2,
  urgent_care: 3,
  emergency: 4,
};

function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

export interface SymptomGuidance {
  urgency_level: UrgencyLevel;
  headline: string;
  summary: string;
  recommendations: string[];
  self_care_tips: string[];
  see_doctor_if: string[];
  red_flags_detected: string[];
  related_areas: string[];
  disclaimer: string;
}

const HEADLINES: Record<UrgencyLevel, string> = {
  emergency: "Seek emergency care now",
  urgent_care: "Get medical care today",
  consult_doctor: "Book an appointment with a doctor",
  monitor: "Monitor your symptoms closely",
  self_care: "Self-care at home is likely appropriate",
};

const SUMMARIES: Record<UrgencyLevel, string> = {
  emergency:
    "One or more of your symptoms can be a sign of a serious condition. Call your local emergency number or go to the nearest emergency department immediately. Do not drive yourself if you feel unwell.",
  urgent_care:
    "Your combination of symptoms, severity and duration suggests you should be seen by a healthcare professional today, at an urgent care clinic or your doctor's same-day service.",
  consult_doctor:
    "Your symptoms are worth discussing with a doctor. Schedule an appointment in the next few days, sooner if things get worse.",
  monitor:
    "Your symptoms are usually manageable at home, but keep track of how they change. Contact a doctor if they worsen or do not improve.",
  self_care:
    "Your symptoms appear mild and short-lived. Rest and simple home care usually help. Contact a doctor if anything changes.",
};

export function evaluateSymptoms(symptomIds: string[], duration: Duration, severity: Severity): SymptomGuidance {
  const selected = symptomIds
    .map((id) => CATALOG_BY_ID.get(id))
    .filter((s): s is SymptomDefinition => Boolean(s));

  const redFlags = selected.filter((s) => s.red_flag);
  const score =
    selected.reduce((sum, s) => sum + s.weight, 0) + DURATION_FACTOR[duration] + SEVERITY_FACTOR[severity];

  let urgency: UrgencyLevel = "self_care";
  if (redFlags.length > 0) {
    urgency = "emergency";
  } else {
    if (score >= 10) urgency = "urgent_care";
    else if (score >= 6) urgency = "consult_doctor";
    else if (score >= 3) urgency = "monitor";

    if (selected.some((s) => s.needs_review)) urgency = maxUrgency(urgency, "consult_doctor");
    if (duration === "more_than_2_weeks" || duration === "1_2_weeks") urgency = maxUrgency(urgency, "consult_doctor");
    if (severity === "severe") urgency = maxUrgency(urgency, "consult_doctor");
    const has = (id: string) => selected.some((s) => s.id === id);
    if (has("high_fever") && (severity === "severe" || DURATION_FACTOR[duration] >= 2)) {
      urgency = maxUrgency(urgency, "urgent_care");
    }
    if ((has("vomiting") || has("diarrhea")) && severity === "severe") urgency = maxUrgency(urgency, "urgent_care");
    if (has("blood_in_stool") && severity !== "mild") urgency = maxUrgency(urgency, "urgent_care");
  }

  const selfCare = Array.from(new Set(selected.flatMap((s) => s.self_care))).slice(0, 8);
  const related = Array.from(new Set(selected.map((s) => s.category)));

  const recommendations: string[] = [];
  if (urgency === "emergency") {
    recommendations.push("Call your local emergency number or go to the nearest emergency department now.");
    recommendations.push("If possible, have someone stay with you until help arrives.");
    if (selected.some((s) => s.id === "self_harm_thoughts")) {
      recommendations.push("Contact a crisis helpline or emergency services right away — you deserve support and you are not alone.");
    }
  } else if (urgency === "urgent_care") {
    recommendations.push("Arrange to see a doctor or visit an urgent care clinic today.");
    recommendations.push("Keep a note of your symptoms, when they started and any medicines you have taken.");
  } else if (urgency === "consult_doctor") {
    recommendations.push("Schedule an appointment with your doctor within the next few days.");
    recommendations.push("Record your symptoms daily so you can share an accurate history.");
  } else if (urgency === "monitor") {
    recommendations.push("Rest and follow the self-care tips below.");
    recommendations.push("Re-check your symptoms in 24–48 hours; book a doctor visit if they are not improving.");
  } else {
    recommendations.push("Rest, stay hydrated and follow the self-care tips below.");
    recommendations.push("Most mild symptoms improve within a few days.");
  }
  recommendations.push("Do not start, stop or change prescribed medication without talking to a doctor or pharmacist.");

  const seeDoctorIf = [
    "Symptoms get worse or new symptoms appear",
    "Symptoms last longer than 7 days without improvement",
    "You have a fever above 39.4 °C (103 °F) or a fever lasting more than 3 days",
    "You cannot keep fluids down or show signs of dehydration (very dark urine, little urine, dizziness)",
    "You are pregnant, elderly, or have a long-term condition such as diabetes, heart, lung or kidney disease",
    "You develop chest pain, difficulty breathing, confusion, fainting or one-sided weakness — call emergency services",
  ];

  return {
    urgency_level: urgency,
    headline: HEADLINES[urgency],
    summary: SUMMARIES[urgency],
    recommendations,
    self_care_tips: urgency === "emergency" ? [] : selfCare,
    see_doctor_if: seeDoctorIf,
    red_flags_detected: redFlags.map((s) => s.label),
    related_areas: related,
    disclaimer: MEDICAL_DISCLAIMER,
  };
}

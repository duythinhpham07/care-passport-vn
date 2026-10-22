[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

_Care Passport VN: a patient-held health record that no hospital admin, insurer or AI assistant can open without the patient's own key._

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

As Vietnam digitises health records and adopts AI triage, we make the patient, not the database, the gatekeeper. Hospitals still store records and AI still helps, but they only read what the patient hands over, record by record.

### 2. Trust constraint insight

Today, whoever runs the server can read everything: admins, insiders, vendors, and anyone who breaches them. Patients hide sensitive history (HIV, mental health, allergies) from doctors because they cannot control who else sees it. Once no single party holds the key, hospitals can store the data without being able to read it.

### 3. Value & impact

Take a student with an anxiety diagnosis and a penicillin allergy. They can safely share the allergy with an ER doctor or an AI triage bot without exposing their mental-health history. A leaked hospital database becomes useless ciphertext. Clinics adopt AI without holding plaintext.

### 4. Why TideCloak matters

Records are encrypted in the browser with TideCloak `doEncrypt`/`doDecrypt`, bound to the patient's Tide identity. The key is never assembled on our server. The realm runs with TideCloak IGA governance, so role changes need approval rather than a lone admin's click. With an ordinary login and backend permissions, our server could decrypt everything. With TideCloak, it cannot.

### 5. Prototype & storytelling

Watch three panels: ① the patient encrypts Vietnamese medical notes and sees them decrypted locally; ② "Dump hospital database" shows that an admin only gets ciphertext; ③ the AI assistant reading the DB on its own gets **0 readable records**, and gets a useful summary only after the patient ticks records to share.

Demo video: [`demo.mp4`](demo.mp4)

## Setup

Requirements: Docker, Node ≥ 20.9, `curl`, `jq`, bash (Linux/WSL).

```bash
# 1. Start TideCloak (dev)
docker run --name mytidecloak -d -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  tideorg/tidecloak-dev:latest

# 2. Install and provision the realm (prints a Tide enrollment link to open)
npm install
npm run init          # writes tidecloak.json

# 3. Run
npm run dev           # http://localhost:3000
```

Key files: `app/home/page.tsx` (patient, admin and AI panels), `app/api/records` (ciphertext-only storage, Tide token verified), `app/api/hospital-db` (simulated admin dump), `app/api/ai` (mock AI triage, synthetic data only).

Team **oldbie** (PTIT, RMIT Hackathon 2026, Hanoi).

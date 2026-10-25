# Invention Disclosure: AI-Powered Crop Disease Detection System for Indian Farmers

## Applicant
Name: Madhav Arora  
Address: New Delhi, India  
Date: October 2026

---

## Title of Invention

**A Method and System for Real-Time Crop Disease Detection and Advisory Using Convolutional Neural Networks on Low-Cost Mobile Devices**

---

## Field of the Invention

This invention relates to agricultural technology, specifically to a mobile-based system that uses artificial intelligence and image recognition to detect crop diseases in real time, generate advisory messages in regional Indian languages, and recommend organic treatments sourced from local markets — designed for smallholder farmers with basic smartphones and low internet connectivity.

---

## Background

Indian farmers lose an estimated 15–25% of crop yield annually due to diseases that go undetected until visible damage is widespread. Current solutions require either laboratory testing (expensive, slow, inaccessible in rural areas) or agronomist visits (scarce, costly). Existing mobile apps require constant internet connectivity and are available only in English, making them inaccessible to the majority of India's 120 million smallholder farmers.

There is no existing system that combines:
- Offline-capable deep learning inference on low-end Android devices (< ₹5,000 handsets)
- Multi-language advisory in Hindi, Marathi, Punjabi, Telugu, and Tamil
- Integration with a geo-tagged database of local agrochemical and organic remedy suppliers
- Automated advisory SMS delivery for farmers without smartphones via a USSD gateway

---

## Summary of the Invention

The invention provides a complete pipeline comprising:

1. A lightweight Convolutional Neural Network (CNN) model — MobileNetV3 architecture, quantized to INT8 — that runs entirely on-device without internet access, trained on a dataset of 85,000 labelled images of 38 crop diseases common to Indian agriculture (wheat blast, rice sheath blight, cotton bollworm, etc.)

2. A mobile application (Android) that captures a photo of the affected crop leaf or stem, runs the CNN inference locally, and displays:
   - Disease name and confidence score
   - Severity classification (mild / moderate / severe)
   - Recommended treatment options (chemical and organic), sourced preferentially from within a 20 km radius using GPS

3. A multi-language Natural Language Generation (NLG) module that converts structured disease advisory data into plain-language advisory text in the farmer's preferred regional language using a pre-compiled template engine — no LLM API call required, fully offline

4. A USSD/SMS gateway integration that allows feature-phone farmers to receive a 160-character disease advisory by dialling a short code (*321#), entering their crop type and describing symptoms via numeric menu, and receiving a response within 90 seconds

5. A federated learning mechanism where anonymised, GPS-tagged disease detection events are aggregated centrally (with farmer consent) to update a national crop disease heatmap, helping state agricultural departments issue early warnings

---

## Detailed Description of the Preferred Embodiments

### Embodiment 1 — On-Device Inference

The CNN model is compiled using TensorFlow Lite and stored as a `.tflite` file (< 8 MB) bundled within the APK. At inference time:

- The user photographs the affected plant part using the device camera
- The image is pre-processed: resized to 224×224 pixels, normalised to [0,1] range
- The INT8-quantized MobileNetV3-Small model runs inference in < 300 milliseconds on a Qualcomm Snapdragon 425 (the processor used in entry-level handsets sold at ₹4,999)
- The top-3 disease predictions with confidence scores are returned
- If the top prediction confidence is below 0.65, the system prompts the farmer to retake the photo under better lighting conditions

### Embodiment 2 — Regional Language Advisory

The NLG module uses a slot-filling template system:

```
Template (Hindi): "आपकी [CROP] में [DISEASE] रोग पाया गया है। 
गंभीरता: [SEVERITY]। सुझाया गया उपचार: [TREATMENT_1] 
या [TREATMENT_2], जो [DISTANCE] किमी के भीतर [SUPPLIER] 
पर उपलब्ध है।"
```

Templates are pre-compiled for 6 languages and 38 × 3 severity combinations = 684 template variants stored in a 2.1 MB JSON file. No network call is made.

### Embodiment 3 — Geo-Tagged Supplier Lookup

The application bundles a SQLite database (12 MB) of 48,000 registered agrochemical and organic remedy suppliers across India, sourced from the eNAM (National Agriculture Market) and state agriculture department APIs. The lookup query:

```sql
SELECT supplier_name, product_name, distance_km
FROM suppliers
WHERE crop_disease = ? AND state_code = ?
ORDER BY distance_km ASC LIMIT 3;
```

is executed locally in < 50 ms.

### Embodiment 4 — USSD Gateway

The USSD gateway integration uses a two-way USSD session:

1. Farmer dials `*321#`
2. System presents a menu: Select crop (1=Wheat, 2=Rice, 3=Cotton…)
3. Farmer selects symptom category from a second menu
4. The backend matches crop + symptom to the top CNN prediction for that combination (pre-computed for all 38 diseases × crop types)
5. A 160-character SMS advisory is sent within 90 seconds via integration with BSNl/Airtel USSD APIs under the TRAI regulatory framework

### Embodiment 5 — Federated Disease Heatmap

With explicit opt-in consent:
- Each detection event (crop type, GPS coordinates truncated to taluka level, disease identified, severity) is queued locally
- When the device next has internet connectivity, events are uploaded to a central aggregation server
- No raw images are transmitted; only the structured detection metadata
- The central server updates a tile-based heatmap (zoom level 8 = taluka granularity) exposed as a public API to state agriculture departments

---

## Claims

**Claim 1 (Independent):**
A method for crop disease detection comprising:
receiving a digital image of an affected crop plant part captured by a mobile device;
processing said image through an INT8-quantized convolutional neural network executing entirely on the mobile device without network connectivity;
generating a disease classification output comprising a disease identifier and a confidence score;
retrieving a treatment advisory from a locally stored template database in a user-selected regional Indian language; and
displaying the advisory on the mobile device screen within five seconds of image capture.

**Claim 2 (Dependent on Claim 1):**
The method of Claim 1, wherein the convolutional neural network is a MobileNetV3-Small architecture trained on a dataset comprising at least 80,000 labelled images of crop diseases prevalent in Indian agriculture.

**Claim 3 (Dependent on Claim 1):**
The method of Claim 1, further comprising:
querying a locally stored geo-tagged supplier database to identify at least one source of recommended treatment within a configurable radius of the mobile device's GPS coordinates.

**Claim 4 (Independent):**
A system for delivering crop disease advisory to farmers without smartphone access comprising:
a USSD gateway interface configured to receive structured symptom inputs via a numeric menu session initiated by dialling a short code;
a pre-computed disease-symptom lookup table mapping crop type and symptom category to a disease identifier;
an SMS generation module configured to produce a treatment advisory not exceeding 160 characters in a regional Indian language; and
a telecommunications interface configured to deliver said SMS advisory within 90 seconds of session initiation.

**Claim 5 (Dependent on Claim 4):**
The system of Claim 4, wherein the telecommunications interface operates under compliance with the Telecom Regulatory Authority of India (TRAI) regulations for USSD-based agricultural advisory services.

**Claim 6 (Independent):**
A federated data aggregation method for crop disease surveillance comprising:
collecting, with explicit user consent, anonymised crop disease detection events on a plurality of mobile devices, each event comprising a crop type identifier, a disease identifier, a severity level, and GPS coordinates truncated to taluka administrative level;
transmitting said events to a central aggregation server only when network connectivity is available;
aggregating events into a tile-based geographic heatmap; and
publishing said heatmap via an open API accessible to state agriculture department systems.

---

## Abstract

A mobile-based crop disease detection and advisory system for Indian smallholder farmers. An INT8-quantized MobileNetV3 CNN model runs entirely on low-cost Android devices (offline, < 300 ms inference), classifying 38 Indian crop diseases from a single photograph. Advisory text is generated offline in 6 regional Indian languages via pre-compiled templates. A geo-tagged local supplier database recommends treatments available within 20 km. Feature-phone farmers are served via a USSD/SMS gateway (*321#) delivering 160-character advisories in under 90 seconds. Anonymised disease detection events are federated to a national crop disease heatmap with farmer consent. The system is designed for deployment under India's Digital Agriculture Mission framework.

---

## Drawings Reference

- Figure 1: System architecture overview
- Figure 2: CNN inference pipeline on mobile device
- Figure 3: USSD session flow diagram
- Figure 4: Federated heatmap data flow

---

## Prior Art Known to Applicant

- Existing apps (e.g., Plantix, AgroStar) require constant internet and are English-only
- Academic work on PlantVillage dataset (Hughes & Salathé, 2015) — arXiv:1511.08060
- No known prior art combining offline inference + USSD gateway + federated heatmap in a single system for Indian agricultural conditions

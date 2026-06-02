# Prototype Brief: Transaction Import & Approval System

## 1. Objective

Design a prototype for a dual-role system that enables:

- Importers to upload and review transaction files
- Approvers to review, approve/reject, and export transactions

The prototype must reflect:

- File-driven ingestion (via File Logs)
- Transaction lifecycle states
- Role-based interaction constraints

---

## 2. Core Domain Model (from API)

The system revolves around three primary objects:

### 1. File Log

Represents an uploaded file and its processing state Key attributes:

- `Id`
- `FileName`
- `RecordCount`
- `LastExecutedActivityName` (To be used as status of file)
- `ProcessDate`
- `IsActive`

### 2. Transaction

Represents individual records extracted from a file Key attributes:

- `Id`
- `FileLogId`
- `Reference`
- `TransactionDate`
- `AccountNumber`
- `Amount`
- `Currency`
- `Status` (Imported / Approved / Rejected)
- `UserNote`

### 3. User

Authenticated via:

- `POST /v1/users/login`

---

## 3. Key System Relationships

- One **File Log → many Transactions**
- Transactions inherit context from FileLog (file name, source)
- Actions on transactions affect **status only**, not structure

---

## 4. Roles & Permissions

### Importer

- Upload files
- View transactions
- Search/filter
- View file summaries
- ❌ Cannot approve/reject

### Approver

- View transactions
- Search/filter
- Approve/reject
- Export data
- View file summaries
- ❌ Cannot upload

---

## 5. Key User Flows

---

### 5.1 Authentication

**Endpoint**

- `POST /v1/users/login`

**Flow**

1. User enters email + password
2. On success → route to role-specific landing
3. On failure → error state

---

### 5.2 File Upload (Importer only)

**Endpoint**

- `POST /v1/files/upload`

**Flow**

1. Select file
2. Provide:
    - FileSettingId
    - FileSettingName
    - FileName

3. Upload
4. System creates FileLog
5. Status shown in UI

**Prototype screens**

- Upload panel (drag & drop)
- Upload progress state
- Success / failure feedback

---

### 5.3 File Log Overview (Shared)

**Endpoint**

- `GET /v1/file-logs`

**Purpose** Anchor object for the system

**UI Requirements**

- Table of uploaded files
- Columns:
    - File Name
    - Process Date
    - Record Count
    - Status

- Row click → drill into transactions

---

### 5.4 Transaction Table (Core Screen)

**Endpoint**

- `GET /v1/transactions`

**This is the primary working surface.**

**UI Requirements**

- Data table with:
    - Reference
    - Date
    - Account
    - Amount
    - Currency
    - Status

- Row-level actions (Approver only):
    - Approve
    - Reject

---

### 5.5 Search & Filtering

**Applied to**

- Transactions table
- File logs

**Filters**

- Status (Imported / Approved / Rejected)
- File (FileLogId)
- Date range
- Amount range
- Text search (Reference, Account)

---

### 5.6 Approve Transaction

**Endpoint**

- `POST /v1/transactions/approve`

**Flow**

1. Select transaction
2. Click approve
3. Confirm action
4. Status updates to Approved

---

### 5.7 Reject Transaction

**Endpoint**

- `POST /v1/transactions/reject`

**Flow**

1. Select transaction
2. Click reject
3. Enter **mandatory note**
4. Submit
5. Status updates to Rejected

---

### 5.8 Export Transactions (Approver)

**Endpoint**

- Uses filtered dataset (no explicit endpoint provided → simulate)
- Build logic to export the transactions datagrid into csv file (data gotten from GET /v1/transactions endpoint)

**UI Requirements**

- Export button
- Applies current filters
- Formats:
    - CSV (default)

---

### 5.9 File Summary View

**Derived from FileLog + Transactions**

**UI Requirements**

- Total records
- Count by status:
    - Imported
    - Approved
    - Rejected

---

## 6. Critical States (Do NOT skip this)

This is where most prototypes fail.

### Transaction States

- Imported
- Approved
- Rejected

### File States (inferred)

- Uploaded
- Processing
- Completed
- Failed

### UI Implications

- Disable approve/reject if not “Imported”
- Show counts per state
- Reflect status changes instantly

---

## 7. Information Architecture

**Top-level navigation**

- Dashboard (File Logs)
- Transactions
- Upload (Importer only)

---

## 8. Key Screens to Prototype

1. Login
2. File Log List (Dashboard)
3. File Upload (Importer)
4. Transaction Table (Shared core)
5. Transaction Detail / Action modal
6. File Summary view
7. Export interaction

---

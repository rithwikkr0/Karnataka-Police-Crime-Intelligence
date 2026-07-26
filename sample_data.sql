-- =============================================================================
-- KSP Crime Database — Sample / Demo Data (Official FIR System ER Alignment)
-- =============================================================================
-- Demo login credentials (KGID + password):
--   KGID: KSP001  Password: demo123  (Inspector Rajesh Kumar - Bengaluru Central)
--   KGID: KSP002  Password: demo123  (Sub-Inspector Priya Nair - Mysuru City)
--   KGID: KSP003  Password: demo123  (Head Constable ಮಹೇಶ್ ಗೌಡ - Kolar District)
-- =============================================================================

-- 1. CaseStatusMaster
INSERT INTO CaseStatusMaster (CaseStatusID, CaseStatusName) VALUES
  (1, 'Open'),
  (2, 'Under Investigation'),
  (3, 'Charge Sheeted'),
  (4, 'Closed'),
  (5, 'Solved');

-- 2. CrimeSubHead
INSERT INTO CrimeSubHead (CrimeSubHeadID, CrimeHeadID, CrimeHeadName) VALUES
  (1, 10, 'Burglary'),
  (2, 20, 'Theft'),
  (3, 30, 'Fraud'),
  (4, 40, 'Vehicle Theft'),
  (5, 50, 'Assault'),
  (6, 60, 'Kidnapping'),
  (7, 70, 'Drug Trafficking');

-- 3. Unit (Police Stations)
INSERT INTO Unit (UnitID, UnitName) VALUES
  (1, 'Bengaluru Central'),
  (2, 'Mysuru City'),
  (3, 'Kolar District'),
  (4, 'Shivajinagar Station'),
  (5, 'Mangaluru Port Station'),
  (6, 'Hubli Old Town Station'),
  (7, 'Tumkur Station'),
  (8, 'Hassan Station'),
  (9, 'Belagavi Station'),
  (10, 'Davangere Station');

-- 4. Employee (Officers - passwords set by Python at runtime)
INSERT INTO Employee (EmployeeID, UnitID, RankID, DesignationID, KGID, FirstName, GenderID, cases_solved_count, password_hash) VALUES
  (1, 1, 1, 1, 'KSP001', 'Inspector Rajesh Kumar',   1, 12, '<hashed by app.py>'),
  (2, 2, 2, 2, 'KSP002', 'Sub-Inspector Priya Nair',  2, 8,  '<hashed by app.py>'),
  (3, 3, 3, 3, 'KSP003', 'Head Constable ಮಹೇಶ್ ಗೌಡ',  1, 5,  '<hashed by app.py>');

-- 5. CaseMaster
INSERT INTO CaseMaster (CaseMasterID, CrimeNo, CaseNo, CrimeRegisteredDate, PolicePersonID, PoliceStationID, CrimeMinorHeadID, CaseStatusID, IncidentFromDate, BriefFacts, resolution_notes, confidence_flag) VALUES
  (1, '001/2024', 'KSP/KOL/2024/001', '2024-03-15', 3, 3, 1, 5, '2024-03-15',
   'Residential burglary at night; jewelry and cash stolen; suspect entered through rear window.',
   'CCTV footage from nearby ATM identified suspect. Pawn shop in Kolar town confirmed jewelry sale. Arrested within 72 hours.', 'verified'),

  (2, '042/2024', 'KSP/BLR/2024/042', '2024-05-22', 1, 1, 2, 5, '2024-05-22',
   'Pickpocket operation in crowded market; multiple victims; mobile phones and wallets stolen.',
   'Decoy officers deployed in market. Suspect apprehended in the act. Stolen items recovered.', 'verified'),

  (3, '015/2024', 'KSP/MYS/2024/015', '2024-07-10', 2, 2, 2, 1, '2024-07-10',
   'Donation box theft at Chamundeshwari temple; 3-woman group distracted priest.', NULL, 'verified'),

  (4, '007/2024', 'KSP/MNG/2024/007', '2024-08-05', 1, 5, 3, 1, '2024-08-05',
   'Investment fraud; victim lost Rs 15 lakhs; suspect posed as SEBI-registered broker.', NULL, 'ai_extracted'),

  (5, '033/2024', 'KSP/HBL/2024/033', '2024-09-12', 3, 6, 4, 1, '2024-09-12',
   'Two-wheeler theft from hospital parking lot; CCTV damaged; midnight incident.', NULL, 'ai_extracted'),

  (6, '011/2024', 'KSP/TMK/2024/011', '2024-06-18', 2, 7, 5, 5, '2024-06-18',
   'Grievous hurt with blunt object outside bar; multiple witnesses.',
   'Witnesses identified suspect via photo lineup. Arrested at residence. Weapon recovered.', 'verified'),

  (7, '009/2024', 'KSP/HSN/2024/009', '2024-10-02', 1, 8, 3, 1, '2024-10-02',
   'Revenue Inspector impersonation; bribe collected from 7 farmers; total Rs 2.1 lakhs.', NULL, 'ai_extracted'),

  (8, '089/2024', 'KSP/BLR/2024/089', '2024-11-15', 1, 1, 6, 1, '2024-11-15',
   'Minor child kidnapping attempt near school; suspect fled in auto-rickshaw.', NULL, 'ai_extracted'),

  (9, '021/2024', 'KSP/BLG/2024/021', '2024-12-01', 3, 9, 1, 1, '2024-12-01',
   'Jewelry shop burglary at 2 AM; safe cracked; loss Rs 8 lakhs; night watchman sedated.', NULL, 'verified'),

  (10, '055/2024', 'KSP/DVG/2024/055', '2024-08-28', 2, 10, 7, 5, '2024-08-28',
   '500g ganja and 50g heroin recovered; suspect arrested; part of larger network.',
   'Narcotics unit surveillance 2 weeks prior to arrest. Supply chain traced. NDPS charge-sheeted.', 'verified');

-- 6. Accused
INSERT INTO Accused (AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID, PersonID, aliases, description, last_known_location, status, confidence_flag) VALUES
  (1, 1, 'ಅರ್ಜುನ್ ರೆಡ್ಡಿ',  32, 1, 'A1', 'Arjun, Raju',         'Male, 30s, scar on left cheek', 'Kolar Gold Fields area',      'wanted',   'ai_extracted'),
  (2, 2, 'Mohammad Saleem',     42, 1, 'A1', 'Saleem, Saleemuddin', 'Male, 40s, known fence',        'Shivajinagar, Bengaluru',     'arrested', 'verified'),
  (3, 4, 'ರಾಘವೇಂದ್ರ ಶೆಟ್ಟಿ', 51, 1, 'A1', 'Raghavendra, Shetty', 'Male, 50s, fake investor',      'Mangaluru port area',         'active',   'ai_extracted'),
  (4, 3, 'Lakshmi Devi',        35, 2, 'A1', 'Lakshmi, Devamma',    'Female, 35, temple thief',      'Mysuru, Chamundeshwari area', 'wanted',   'verified'),
  (5, 5, 'ಸಿದ್ದಯ್ಯ ನಾಯಕ್',   28, 1, 'A1', 'Siddaiah, Nayaka',    'Male, 28, car thief',           'Hubli-Dharwad area',          'active',   'ai_extracted'),
  (6, 6, 'Venkatesh Murthy',    45, 1, 'A1', 'Venki',               'Male, 45, tavern altercations', 'Tumkur district',             'arrested', 'verified'),
  (7, 7, 'ಅನಿತಾ ಕೃಷ್ಣ',      38, 2, 'A1', 'Anita, Krishnamma',   'Female, 38, revenue imposter',  'Hassan district',             'wanted',   'ai_extracted'),
  (8, 8, 'Riyaz Khan',          33, 1, 'A1', 'Riyaz Bhai',          'Male, 33, organized crime',     'Bengaluru North',             'wanted',   'ai_extracted'),
  (9, 9, 'ಗಣೇಶ್ ಪಾಟೀಲ್',     26, 1, 'A1', 'Ganesh, Patil',       'Male, 26, commercial burglar',  'Belagavi area',               'active',   'verified'),
  (10, 10, 'Suresh Babu',       39, 1, 'A1', 'Suresh, S.B.',        'Male, 39, narcotics peddler',   'Davangere city',              'arrested', 'verified');

-- 7. Victim
INSERT INTO Victim (VictimMasterID, CaseMasterID, VictimName, AgeYear, GenderID, VictimPolice) VALUES
  (1, 1, 'Ramesh Hegde',        48, 1, 'No'),
  (2, 2, 'Anand V.',            32, 1, 'No'),
  (3, 3, 'Temple Authority',     0, 0, 'No'),
  (4, 4, 'Kiran Kumar',         41, 1, 'No'),
  (5, 5, 'Prakash Rao',         29, 1, 'No'),
  (6, 6, 'Manjunath B.',        36, 1, 'No'),
  (7, 7, 'Farmer Group',        50, 1, 'No'),
  (8, 8, 'Master Rahul',         9, 1, 'No'),
  (9, 9, 'Swathi Jewellers',     0, 0, 'No'),
  (10, 10, 'State of Karnataka', 0, 0, 'Yes');

-- 8. ComplainantDetails
INSERT INTO ComplainantDetails (ComplainantID, CaseMasterID, ComplainantName, AgeYear, GenderID) VALUES
  (1, 1, 'Ramesh Hegde',               48, 1),
  (2, 2, 'Anand V.',                   32, 1),
  (3, 3, 'Priest Sundaram',            55, 1),
  (4, 4, 'Kiran Kumar',                41, 1),
  (5, 5, 'Prakash Rao',                29, 1),
  (6, 6, 'Bar Manager Shrinivas',      44, 1),
  (7, 7, 'Ningappa (Farmer)',          52, 1),
  (8, 8, 'School Principal Sunitha',   46, 2),
  (9, 9, 'Shop Owner Suresh',          50, 1),
  (10, 10, 'Sub-Inspector Priya Nair', 34, 2);

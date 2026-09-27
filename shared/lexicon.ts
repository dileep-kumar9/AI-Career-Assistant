/**
 * Curated vocabulary used by the deterministic JD analyzer and ATS matcher.
 * Each entry has a canonical label and aliases that count as the same keyword
 * ("AWS" == "Amazon Web Services"). Matching is case-insensitive and
 * word-boundary aware (see matchKeyword in ats.ts).
 */
export type TermCategory = 'language' | 'cloud' | 'devops' | 'os' | 'network' | 'security' | 'data' | 'web' | 'tool' | 'practice' | 'soft';

export interface LexiconTerm {
  label: string;
  aliases?: string[];
  category: TermCategory;
}

const t = (label: string, category: TermCategory, aliases: string[] = []): LexiconTerm => ({ label, category, aliases });

export const LEXICON: LexiconTerm[] = [
  // Languages
  t('Python', 'language'), t('Java', 'language'), t('JavaScript', 'language', ['JS', 'ECMAScript']), t('TypeScript', 'language', ['TS']),
  t('Go', 'language', ['Golang']), t('Rust', 'language'), t('C++', 'language', ['CPP']), t('C#', 'language', ['C Sharp', '.NET C#']), t('C', 'language'),
  t('Ruby', 'language'), t('PHP', 'language'), t('Kotlin', 'language'), t('Swift', 'language'), t('Scala', 'language'), t('R', 'language'),
  t('Bash', 'language', ['Shell', 'Shell scripting', 'shell script', 'shell scripts', 'Bash scripting']), t('PowerShell', 'language', ['PowerShell scripting']),
  t('SQL', 'data', ['T-SQL', 'PL/SQL']), t('HTML', 'web', ['HTML5']), t('CSS', 'web', ['CSS3']),
  // Cloud
  t('AWS', 'cloud', ['Amazon Web Services']), t('Azure', 'cloud', ['Microsoft Azure']), t('GCP', 'cloud', ['Google Cloud', 'Google Cloud Platform']),
  t('EC2', 'cloud', ['Amazon EC2']), t('S3', 'cloud', ['Amazon S3']), t('IAM', 'cloud', ['AWS IAM', 'Identity and Access Management']), t('Lambda', 'cloud', ['AWS Lambda']),
  t('CloudWatch', 'cloud', ['Amazon CloudWatch']), t('CloudFormation', 'cloud', ['AWS CloudFormation']), t('VPC', 'cloud', ['Amazon VPC']), t('RDS', 'cloud', ['Amazon RDS']),
  t('Route 53', 'cloud', ['Route53']), t('ECS', 'cloud', ['Amazon ECS']), t('EKS', 'cloud', ['Amazon EKS']), t('Azure AD', 'cloud', ['Entra ID', 'Microsoft Entra ID']),
  // DevOps
  t('Docker', 'devops', ['containerization']), t('Kubernetes', 'devops', ['K8s']), t('Terraform', 'devops'), t('Ansible', 'devops'),
  t('Jenkins', 'devops'), t('GitHub Actions', 'devops'), t('GitLab CI', 'devops', ['GitLab CI/CD']), t('CI/CD', 'devops', ['CI CD', 'continuous integration', 'continuous delivery', 'continuous deployment']),
  t('Git', 'tool', ['GitHub', 'GitLab', 'version control']), t('Helm', 'devops'), t('Prometheus', 'devops'), t('Grafana', 'devops'), t('Nagios', 'devops'), t('Zabbix', 'devops'),
  t('Puppet', 'devops'), t('Chef', 'devops'), t('Infrastructure as Code', 'devops', ['IaC']), t('Monitoring', 'practice', ['system monitoring', 'infrastructure monitoring']),
  t('Microservices', 'practice'), t('DevOps', 'practice'), t('SRE', 'practice', ['Site Reliability Engineering']),
  // OS / sysadmin
  t('Linux', 'os', ['RHEL', 'Red Hat', 'Ubuntu', 'CentOS', 'Debian']), t('Windows Server', 'os'), t('Windows', 'os'), t('macOS', 'os'), t('Unix', 'os'),
  t('Active Directory', 'os', ['AD DS']), t('Group Policy', 'os', ['GPO']), t('VMware', 'os', ['vSphere', 'ESXi']), t('Hyper-V', 'os'), t('Virtualization', 'os'),
  t('System Administration', 'practice', ['systems administration', 'sysadmin', 'system administrator']), t('Patch Management', 'practice', ['patching']),
  t('Backup and Recovery', 'practice', ['backup', 'disaster recovery']), t('Office 365', 'tool', ['Microsoft 365', 'M365', 'O365']), t('Exchange', 'tool', ['Exchange Server']),
  t('IIS', 'tool'), t('Apache', 'tool', ['Apache HTTP Server']), t('Nginx', 'tool'), t('Cron', 'tool', ['cron jobs', 'crontab']), t('Systemd', 'tool'),
  // Networking
  t('TCP/IP', 'network', ['TCP IP']), t('DNS', 'network'), t('DHCP', 'network'), t('VPN', 'network'), t('Firewall', 'network', ['firewalls']), t('Routing', 'network'), t('Switching', 'network'),
  t('VLAN', 'network', ['VLANs']), t('BGP', 'network'), t('OSPF', 'network'), t('LAN/WAN', 'network', ['LAN', 'WAN']), t('Load Balancing', 'network', ['load balancer', 'load balancers']),
  t('Cisco', 'network'), t('Wireshark', 'network'), t('Networking', 'network', ['network administration', 'computer networks']), t('VoIP', 'network'), t('SIP', 'network'),
  t('HTTP', 'network', ['HTTPS']), t('SSH', 'network'), t('SSL/TLS', 'network', ['SSL', 'TLS']),
  // Security
  t('SIEM', 'security'), t('Splunk', 'security'), t('QRadar', 'security'), t('Microsoft Sentinel', 'security', ['Azure Sentinel']), t('Elastic Stack', 'security', ['ELK', 'Elasticsearch', 'Kibana', 'Logstash']),
  t('SOC', 'security', ['Security Operations Center', 'security operations']), t('Incident Response', 'security', ['incident handling']), t('Threat Hunting', 'security'),
  t('Threat Intelligence', 'security'), t('Vulnerability Management', 'security', ['vulnerability assessment', 'vulnerability scanning']), t('Nessus', 'security'), t('Qualys', 'security'),
  t('Penetration Testing', 'security', ['pentesting', 'pen testing', 'ethical hacking']), t('Metasploit', 'security'), t('Burp Suite', 'security'), t('Nmap', 'security'),
  t('IDS/IPS', 'security', ['IDS', 'IPS', 'intrusion detection']), t('EDR', 'security', ['endpoint detection and response', 'CrowdStrike', 'Microsoft Defender']), t('Malware Analysis', 'security'),
  t('MITRE ATT&CK', 'security', ['MITRE ATTACK', 'ATT&CK']), t('NIST', 'security', ['NIST CSF']), t('ISO 27001', 'security'), t('OWASP', 'security'), t('Log Analysis', 'security', ['log monitoring', 'log review']),
  t('Cybersecurity', 'security', ['cyber security', 'information security', 'infosec']), t('Encryption', 'security'), t('Identity Management', 'security', ['IAM policies', 'access management']),
  t('Phishing Analysis', 'security', ['phishing']), t('Digital Forensics', 'security', ['forensics']), t('Compliance', 'practice', ['regulatory compliance', 'SOX', 'HIPAA', 'PCI DSS', 'GDPR']),
  // Data
  t('MySQL', 'data'), t('PostgreSQL', 'data', ['Postgres']), t('MongoDB', 'data'), t('Redis', 'data'), t('Oracle', 'data', ['Oracle Database']), t('SQL Server', 'data', ['MSSQL', 'Microsoft SQL Server']),
  t('MariaDB', 'data'), t('Excel', 'tool', ['Microsoft Excel', 'MS Excel']), t('Power BI', 'data', ['PowerBI']), t('Tableau', 'data'), t('Pandas', 'data'), t('NumPy', 'data'),
  t('Machine Learning', 'data', ['ML']), t('Deep Learning', 'data'), t('TensorFlow', 'data'), t('PyTorch', 'data'), t('scikit-learn', 'data', ['sklearn']), t('Data Analysis', 'data', ['data analytics']),
  t('ETL', 'data'), t('Apache Spark', 'data', ['Spark', 'PySpark']), t('Hadoop', 'data'), t('Snowflake', 'data'), t('Airflow', 'data', ['Apache Airflow']), t('NLP', 'data', ['natural language processing']),
  t('Statistics', 'data', ['statistical analysis', 'statistical methods', 'descriptive statistics']), t('Data Visualization', 'data', ['data visualisation', 'visualization', 'visualisation']),
  t('Data Cleaning', 'data', ['data cleansing', 'cleaning data', 'data wrangling']), t('Data Modeling', 'data', ['data modelling', 'dimensional modeling']), t('Data Interpretation', 'data', ['interpreting data', 'interpret data']),
  t('Data Validation', 'data', ['validating data']), t('Google Sheets', 'tool'), t('Google Analytics', 'tool', ['GA4']), t('Pivot Tables', 'tool', ['pivot table', 'PivotTables', 'PivotTable']), t('VLOOKUP', 'tool', ['XLOOKUP', 'HLOOKUP']),
  t('Looker Studio', 'data', ['Google Data Studio', 'Data Studio', 'Looker']), t('Dashboards', 'practice', ['dashboard', 'dashboarding']), t('Reporting', 'practice', ['reports', 'report generation']),
  t('Web Scraping', 'data', ['web scrapping', 'data scraping', 'scraping', 'web crawling', 'crawlers']), t('Data Extraction', 'data', ['extracting data', 'data extraction']),
  t('Selenium', 'tool', ['Selenium WebDriver']), t('BeautifulSoup', 'data', ['Beautiful Soup', 'bs4', 'BeautifulSoup4']), t('Scrapy', 'data'), t('Matplotlib', 'data'), t('Seaborn', 'data'),
  t('Tabula', 'data', ['tabula-py']), t('Jupyter Notebook', 'tool', ['Jupyter', 'Jupyter Notebooks', 'JupyterLab']), t('PyCharm', 'tool'), t('Spyder', 'tool'), t('VS Code', 'tool', ['Visual Studio Code', 'VSCode']),
  t('Kafka', 'data', ['Apache Kafka']), t('RabbitMQ', 'data'), t('Message Queues', 'data', ['message queue', 'message queuing', 'MQ']),
  t('Zapier', 'tool'), t('No-Code Automation', 'tool', ['no-code', 'no code', 'low-code', 'low code']), t('OOP', 'practice', ['object-oriented programming', 'object oriented programming', 'OOPs', 'OOPS concepts']),
  t('Backend Development', 'web', ['back-end development', 'backend', 'back end development', 'server-side development']), t('Databases', 'data', ['DBMS', 'DBS', 'DBSs', 'database', 'database management']),
  t('LLM', 'data', ['large language models', 'GPT', 'OpenAI API', 'generative AI', 'GenAI']), t('Computer Vision', 'data', ['OpenCV']),
  // Web / software
  t('React', 'web', ['React.js', 'ReactJS']), t('Angular', 'web'), t('Vue', 'web', ['Vue.js']), t('Node.js', 'web', ['Node', 'NodeJS']), t('Express', 'web', ['Express.js']),
  t('Django', 'web'), t('Flask', 'web'), t('FastAPI', 'web'), t('Spring Boot', 'web', ['Spring']), t('.NET', 'web', ['ASP.NET', 'dotnet']), t('REST API', 'web', ['REST', 'RESTful', 'REST APIs', 'RESTful APIs']),
  t('GraphQL', 'web'), t('Next.js', 'web'), t('Tailwind CSS', 'web', ['Tailwind']), t('Firebase', 'web'), t('Unit Testing', 'practice', ['unit tests', 'Jest', 'pytest', 'JUnit']),
  t('Agile', 'practice', ['Scrum', 'Kanban']), t('Jira', 'tool'), t('Confluence', 'tool'), t('ServiceNow', 'tool'), t('ITIL', 'practice'), t('Postman', 'tool'),
  // Support / practice
  t('Troubleshooting', 'practice', ['troubleshoot', 'troubleshooting issues']), t('Technical Support', 'practice', ['IT support', 'help desk', 'helpdesk', 'service desk', 'desktop support']),
  t('Ticketing Systems', 'practice', ['ticketing', 'ticket management']), t('Documentation', 'practice', ['technical documentation', 'runbooks', 'knowledge base']),
  t('Root Cause Analysis', 'practice', ['RCA']), t('Automation', 'practice', ['scripting', 'task automation']), t('Change Management', 'practice'), t('Incident Management', 'practice'),
  t('Performance Tuning', 'practice', ['performance optimization']), t('High Availability', 'practice'), t('Capacity Planning', 'practice'), t('SLA', 'practice', ['service level agreements']),
  t('Customer Service', 'soft', ['customer support']), t('Communication', 'soft', ['communication skills']), t('Problem Solving', 'soft', ['problem-solving']), t('Critical Thinking', 'soft'), t('Attention to Detail', 'soft', ['detail-oriented', 'detail oriented']), t('Analytical Skills', 'soft', ['analytical thinking', 'analytical']), t('Teamwork', 'soft', ['collaboration', 'cross-functional']),
  t('Leadership', 'soft'), t('Project Management', 'practice'), t('Stakeholder Management', 'soft'),
];

/** Certifications recognised in job descriptions and resumes. */
export const CERTIFICATIONS: LexiconTerm[] = [
  t('AWS Certified Solutions Architect', 'cloud', ['AWS Solutions Architect', 'AWS SAA']), t('AWS Certified Cloud Practitioner', 'cloud', ['AWS Cloud Practitioner']),
  t('AWS Certified SysOps Administrator', 'cloud', ['AWS SysOps']), t('AWS Certified Security', 'cloud', ['AWS Security Specialty']), t('AWS Certified Developer', 'cloud'),
  t('Azure Administrator (AZ-104)', 'cloud', ['AZ-104', 'Azure Administrator Associate']), t('Azure Fundamentals (AZ-900)', 'cloud', ['AZ-900']), t('Azure Security Engineer (AZ-500)', 'cloud', ['AZ-500']),
  t('Google Associate Cloud Engineer', 'cloud', ['Associate Cloud Engineer']), t('CompTIA A+', 'os', ['A+ certification', 'CompTIA A Plus']), t('CompTIA Network+', 'network', ['Network+']),
  t('CompTIA Security+', 'security', ['Security+', 'Sec+']), t('CompTIA CySA+', 'security', ['CySA+']), t('CompTIA Linux+', 'os', ['Linux+']), t('CCNA', 'network', ['Cisco Certified Network Associate']),
  t('CCNP', 'network'), t('RHCSA', 'os', ['Red Hat Certified System Administrator']), t('RHCE', 'os', ['Red Hat Certified Engineer']), t('CISSP', 'security'), t('CISM', 'security'), t('CISA', 'security'),
  t('CEH', 'security', ['Certified Ethical Hacker']), t('OSCP', 'security'), t('GIAC', 'security', ['GSEC', 'GCIH', 'GCIA']), t('CKA', 'devops', ['Certified Kubernetes Administrator']),
  t('Terraform Associate', 'devops', ['HashiCorp Certified Terraform Associate']), t('ITIL Foundation', 'practice', ['ITIL v4', 'ITIL 4']), t('PMP', 'practice', ['Project Management Professional']),
  t('Certified ScrumMaster', 'practice', ['CSM', 'Scrum Master']), t('MCSA', 'os'), t('Microsoft Certified', 'os'),
];

export const DEGREE_PATTERNS: Array<{ level: number; label: string; re: RegExp }> = [
  { level: 4, label: 'Doctorate', re: /\b(ph\.?\s?d|doctorate|doctoral)\b/i },
  // "MS" must not match Microsoft products ("MS Excel", "MS Office").
  { level: 3, label: "Master's degree", re: /\b(master'?s?|m\.?\s?s\.?c?(?!\s*(?:excel|office|word|sql|teams|project|access|azure|dynamics|power))|m\.?\s?tech|m\.?\s?e\.?|mba|mca|m\.?\s?eng)\b/i },
  { level: 2, label: "Bachelor's degree", re: /\b(bachelor'?s?|b\.?\s?s\.?c?|b\.?\s?tech|b\.?\s?e\.?|b\.?\s?a\.?|bca|b\.?\s?eng|undergraduate degree|4-year degree|four-year degree)\b/i },
  { level: 1, label: 'Associate degree / Diploma', re: /\b(associate'?s? degree|diploma|polytechnic)\b/i },
];

export const ACTION_VERBS = new Set(
  (
    'accelerated achieved administered analyzed architected assessed audited automated built capitalized centralized collaborated configured consolidated coordinated created debugged ' +
    'decreased defined delivered deployed designed detected developed diagnosed directed documented drove eliminated enabled engineered enhanced established evaluated executed expanded ' +
    'facilitated generated guided hardened identified implemented improved increased initiated installed instituted integrated investigated launched led leveraged maintained managed ' +
    'mentored migrated modernized monitored negotiated optimized orchestrated organized oversaw partnered performed pioneered planned prepared presented prioritized produced programmed ' +
    'provisioned published reduced refactored remediated reorganized replaced resolved restored restructured reviewed revamped scaled scripted secured simplified spearheaded standardized ' +
    'streamlined strengthened supervised supported tested tracked trained transformed triaged troubleshot tuned upgraded utilized validated wrote handled answered assisted conducted ' +
    'contributed created escalated responded patched backed hosted exposed applied practiced learned studied completed participated served worked provided built used gained helped ensured tuned'
  ).split(/\s+/),
);

export const WEAK_PHRASES = ['responsible for', 'duties included', 'worked on', 'helped with', 'in charge of', 'tasked with'];

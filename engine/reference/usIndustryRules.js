// FMP profile industry -> [sector, industry, sub-industry], learned from the owner's workbook (dominant placement per FMP
// industry among the 744 matched US stocks) plus hand-defined rows where the workbook has no example. Generated 2026-11-20.
// A rule is a BEST FIT for a stock the workbook does not list: the sub-industry is the commonest one for that FMP industry, not
// a per-company judgement. Workbook rows (US_CLASS) always win.
export const US_INDUSTRY_RULES = {
 "Software - Application": [
  "Information Technology",
  "Software",
  "Horizontal Enterprise Applications"
 ],
 "Software - Infrastructure": [
  "Information Technology",
  "Software",
  "Infrastructure, Database & Observability"
 ],
 "Semiconductors": [
  "Information Technology",
  "Semiconductors",
  "Analog, Power & Mixed-Signal ICs"
 ],
 "Information Technology Services": [
  "Information Technology",
  "IT Services",
  "IT Consulting & Outsourcing"
 ],
 "Hardware, Equipment & Parts": [
  "Information Technology",
  "Electronic Equipment & Instruments",
  "Test, Measurement & Sensing"
 ],
 "Aerospace & Defense": [
  "Industrials",
  "Aerospace & Defense",
  "Aerospace Components & Subsystems"
 ],
 "Banks - Regional": [
  "Financials",
  "Banks",
  "Regional & Commercial Banks"
 ],
 "Medical - Devices": [
  "Health Care",
  "Medical Devices",
  "Diversified & Cardiovascular Devices"
 ],
 "Industrial - Machinery": [
  "Industrials",
  "Machinery",
  "Industrial Flow, Motion & Fluid Handling"
 ],
 "Medical - Diagnostics & Research": [
  "Health Care",
  "Life Sciences Tools & Services",
  "Analytical Instruments & Lab Equipment"
 ],
 "Specialty Retail": [
  "Consumer Discretionary",
  "Specialty Retail",
  "Category Specialty Retail"
 ],
 "Insurance - Property & Casualty": [
  "Financials",
  "Insurance",
  "Commercial & Specialty P&C"
 ],
 "Financial - Credit Services": [
  "Financials",
  "Consumer Finance",
  "Card Issuers & Consumer Lenders"
 ],
 "Auto - Parts": [
  "Consumer Discretionary",
  "Auto Components & Retail",
  "OEM Powertrain & Components"
 ],
 "Financial - Capital Markets": [
  "Financials",
  "Capital Markets",
  "Investment Banking & Trading"
 ],
 "Oil & Gas Equipment & Services": [
  "Energy",
  "Oil & Gas Services",
  "Oilfield Services & Equipment"
 ],
 "Packaged Foods": [
  "Consumer Staples",
  "Food Products",
  "Packaged Foods & Confectionery"
 ],
 "Asset Management": [
  "Financials",
  "Capital Markets",
  "Traditional Asset Managers"
 ],
 "Telecommunications Services": [
  "Communication Services",
  "Telecommunication Services",
  "Wireless & Wireline Carriers"
 ],
 "Medical - Care Facilities": [
  "Health Care",
  "Health Care Providers",
  "Hospitals"
 ],
 "Electrical Equipment & Parts": [
  "Industrials",
  "Electrical Equipment",
  "Electrical & Power Distribution Equipment"
 ],
 "Drug Manufacturers - Specialty & Generic": [
  "Health Care",
  "Pharmaceuticals",
  "Generics & Specialty Pharma"
 ],
 "Oil & Gas Exploration & Production": [
  "Energy",
  "Oil & Gas E&P",
  "Oil-Weighted E&P"
 ],
 "REIT - Mortgage": [
  "Financials",
  "Mortgage REITs",
  "Agency Mortgage REITs"
 ],
 "Restaurants": [
  "Consumer Discretionary",
  "Restaurants",
  "Quick-Service & Casual Dining"
 ],
 "Gold": [
  "Materials",
  "Metals & Mining",
  "Gold & Silver Mining"
 ],
 "Specialty Business Services": [
  "Industrials",
  "Commercial Services",
  "Uniforms, Facility & Food Services"
 ],
 "Engineering & Construction": [
  "Industrials",
  "Construction & Engineering",
  "Electrical, Mechanical & Utility Contractors"
 ],
 "Marine Shipping": [
  "Industrials",
  "Transportation",
  "Marine Shipping (Crude Tankers)"
 ],
 "Communication Equipment": [
  "Information Technology",
  "Communications Equipment",
  "Switching, Routing & Optical Transport"
 ],
 "Construction Materials": [
  "Materials",
  "Construction Materials",
  "Cement, Aggregates & Building Envelope"
 ],
 "Entertainment": [
  "Communication Services",
  "Media & Entertainment",
  "Diversified Entertainment (Studios, Networks, Parks)"
 ],
 "REIT - Retail": [
  "Real Estate",
  "Retail REITs",
  "Shopping Centers & Malls"
 ],
 "Medical - Instruments & Supplies": [
  "Health Care",
  "Medical Devices",
  "Medical Consumables, Sterilization & Packaging"
 ],
 "Gambling, Resorts & Casinos": [
  "Consumer Discretionary",
  "Casinos & Gaming",
  "Integrated Resorts & Online Betting"
 ],
 "Real Estate - Services": [
  "Real Estate",
  "Real Estate Services",
  "Commercial Real Estate Services"
 ],
 "Other Precious Metals": [
  "Materials",
  "Metals & Mining",
  "Gold & Silver Mining"
 ],
 "Computer Hardware": [
  "Information Technology",
  "Computer Hardware",
  "Data Storage Hardware"
 ],
 "Apparel - Retail": [
  "Consumer Discretionary",
  "Specialty Retail",
  "Category Specialty Retail"
 ],
 "Furnishings, Fixtures & Appliances": [
  "Consumer Discretionary",
  "Household Durables",
  "Home Furnishings & Mattresses"
 ],
 "Household & Personal Products": [
  "Consumer Staples",
  "Household & Personal Products",
  "Household & Hygiene Products"
 ],
 "Auto - Dealerships": [
  "Consumer Discretionary",
  "Auto Components & Retail",
  "Dealerships & Used-Vehicle Retail"
 ],
 "REIT - Diversified": [
  "Real Estate",
  "Net-Lease REITs",
  "Single-Tenant Net Lease"
 ],
 "Residential Construction": [
  "Consumer Discretionary",
  "Household Durables",
  "Homebuilding"
 ],
 "Insurance - Specialty": [
  "Financials",
  "Insurance",
  "Title, Warranty & Fee-Based Insurance Services"
 ],
 "Advertising Agencies": [
  "Communication Services",
  "Advertising & Marketing Services",
  "Agency Holding Companies"
 ],
 "Industrial - Distribution": [
  "Industrials",
  "Trading Companies & Distributors",
  "Industrial & Electrical MRO Distribution"
 ],
 "Airlines, Airports & Air Services": [
  "Industrials",
  "Transportation",
  "Passenger Airlines"
 ],
 "Rental & Leasing Services": [
  "Industrials",
  "Trading Companies & Distributors",
  "Equipment & Truck Rental"
 ],
 "Regulated Gas": [
  "Utilities",
  "Gas Utilities",
  "Regulated Gas Distribution"
 ],
 "Staffing & Employment Services": [
  "Industrials",
  "Professional Services",
  "Payroll & HR Outsourcing"
 ],
 "Conglomerates": [
  "Industrials",
  "Industrial Conglomerates",
  "Diversified Industrial Manufacturing"
 ],
 "REIT - Hotel & Motel": [
  "Real Estate",
  "Hotel REITs",
  "Lodging REITs"
 ],
 "REIT - Industrial": [
  "Real Estate",
  "Industrial REITs",
  "Logistics & Industrial"
 ],
 "REIT - Healthcare Facilities": [
  "Real Estate",
  "Health Care REITs",
  "Senior Housing & Medical Properties"
 ],
 "Packaging & Containers": [
  "Materials",
  "Containers & Packaging",
  "Flexible & Plastic Packaging and Labels"
 ],
 "Apparel - Manufacturers": [
  "Consumer Discretionary",
  "Apparel, Footwear & Luxury",
  "Branded Apparel & Accessories"
 ],
 "Insurance - Life": [
  "Financials",
  "Insurance",
  "Life, Annuity & Supplemental"
 ],
 "Oil & Gas Midstream": [
  "Energy",
  "Midstream",
  "Gathering, Processing & Pipelines"
 ],
 "Regulated Electric": [
  "Utilities",
  "Electric Utilities",
  "Regulated Electric Utilities"
 ],
 "Grocery Stores": [
  "Consumer Staples",
  "Food & Staples Retail",
  "Supermarkets"
 ],
 "Trucking": [
  "Industrials",
  "Transportation",
  "Trucking - Truckload & Intermodal"
 ],
 "Regulated Water": [
  "Utilities",
  "Water Utilities",
  "Regulated Water"
 ],
 "Broadcasting": [
  "Communication Services",
  "Media & Entertainment",
  "Broadcasting & Cable Networks"
 ],
 "Auto - Manufacturers": [
  "Consumer Discretionary",
  "Automobiles",
  "Legacy Vehicle OEMs"
 ],
 "REIT - Residential": [
  "Real Estate",
  "Residential REITs",
  "Apartments"
 ],
 "Apparel - Footwear & Accessories": [
  "Consumer Discretionary",
  "Apparel, Footwear & Luxury",
  "Athletic & Lifestyle Brands"
 ],
 "Chemicals": [
  "Materials",
  "Chemicals",
  "Commodity & Diversified Chemicals"
 ],
 "Chemicals - Specialty": [
  "Materials",
  "Chemicals",
  "Specialty Chemicals, Coatings & Ingredients"
 ],
 "Agricultural Farm Products": [
  "Consumer Staples",
  "Food Products",
  "Agribusiness & Oilseed/Grain Processing"
 ],
 "Insurance - Brokers": [
  "Financials",
  "Insurance",
  "Insurance Brokerage"
 ],
 "Consulting Services": [
  "Industrials",
  "Professional Services",
  "Government IT & Mission Services"
 ],
 "Travel Services": [
  "Consumer Discretionary",
  "Travel & Leisure",
  "Online Travel & Lodging Platforms"
 ],
 "Medical - Specialties": [
  "Health Care",
  "Medical Devices",
  "Medical Consumables, Sterilization & Packaging"
 ],
 "Insurance - Diversified": [
  "Financials",
  "Insurance",
  "Commercial & Specialty P&C"
 ],
 "Solar": [
  "Industrials",
  "Electrical Equipment",
  "Solar Modules & Trackers"
 ],
 "Integrated Freight & Logistics": [
  "Industrials",
  "Transportation",
  "Parcel & Integrated Logistics"
 ],
 "Manufacturing - Metal Fabrication": [
  "Materials",
  "Metals & Mining",
  "Specialty Alloys"
 ],
 "Steel": [
  "Materials",
  "Metals & Mining",
  "Steel Producers"
 ],
 "Financial - Mortgages": [
  "Financials",
  "Consumer Finance",
  "Mortgage Origination & Servicing"
 ],
 "Agricultural - Machinery": [
  "Industrials",
  "Machinery",
  "Construction & Agricultural Machinery"
 ],
 "Oil & Gas Refining & Marketing": [
  "Energy",
  "Refining & Marketing",
  "Independent Refiners"
 ],
 "Waste Management": [
  "Industrials",
  "Environmental Services",
  "Solid Waste Collection & Disposal"
 ],
 "Travel Lodging": [
  "Consumer Discretionary",
  "Hotels, Resorts & Cruise Lines",
  "Hotel Franchising & Management"
 ],
 "Paper, Lumber & Forest Products": [
  "Materials",
  "Paper & Forest Products",
  "Timber & Wood Products"
 ],
 "Agricultural Inputs": [
  "Materials",
  "Chemicals",
  "Fertilizers"
 ],
 "Financial - Conglomerates": [
  "Financials",
  "Diversified Financials",
  "Diversified Holding Companies"
 ],
 "Beverages - Non-Alcoholic": [
  "Consumer Staples",
  "Beverages",
  "Non-Alcoholic Beverages"
 ],
 "Food Distribution": [
  "Consumer Staples",
  "Food Distribution",
  "Foodservice Distribution"
 ],
 "Drug Manufacturers - General": [
  "Health Care",
  "Pharmaceuticals",
  "Large-Cap Branded Pharma"
 ],
 "Technology Distributors": [
  "Information Technology",
  "Technology Distribution",
  "IT & Electronics Distribution / Resale"
 ],
 "Publishing": [
  "Communication Services",
  "Media & Entertainment",
  "News & Book Publishing"
 ],
 "Medical - Pharmaceuticals": [
  "Health Care",
  "Pharmaceuticals",
  "Generics & Specialty Pharma"
 ],
 "Electronic Gaming & Multimedia": [
  "Communication Services",
  "Interactive Entertainment",
  "Video Games & Game Platforms"
 ],
 "Beverages - Wineries & Distilleries": [
  "Consumer Staples",
  "Beverages",
  "Beer, Wine & Spirits"
 ],
 "Beverages - Alcoholic": [
  "Consumer Staples",
  "Beverages",
  "Beer, Wine & Spirits"
 ],
 "Tobacco": [
  "Consumer Staples",
  "Tobacco",
  "Cigarettes & Smoke-Free Nicotine"
 ],
 "Manufacturing - Tools & Accessories": [
  "Industrials",
  "Machinery",
  "Tools, Welding & Hardware"
 ],
 "Medical - Healthcare Plans": [
  "Health Care",
  "Managed Care",
  "Health Insurers"
 ],
 "Consumer Electronics": [
  "Information Technology",
  "Computer Hardware",
  "Consumer Devices & Ecosystem"
 ],
 "Insurance - Reinsurance": [
  "Financials",
  "Insurance",
  "Reinsurance"
 ],
 "Department Stores": [
  "Consumer Discretionary",
  "Specialty Retail",
  "Off-Price & Department Stores"
 ],
 "Discount Stores": [
  "Consumer Staples",
  "Food & Staples Retail",
  "Dollar Stores"
 ],
 "Railroads": [
  "Industrials",
  "Transportation",
  "Railroads"
 ],
 "Luxury Goods": [
  "Consumer Discretionary",
  "Apparel, Footwear & Luxury",
  "Branded Apparel & Accessories"
 ],
 "Industrial - Specialties": [
  "Industrials",
  "Machinery",
  "Precision Instruments & Diversified Engineered Products"
 ],
 "Silver": [
  "Materials",
  "Metals & Mining",
  "Gold & Silver Mining"
 ],
 "Financial - Data & Stock Exchanges": [
  "Financials",
  "Capital Markets",
  "Exchanges & Trading Venues"
 ],
 "Medical - Distribution": [
  "Health Care",
  "Health Care Distribution",
  "Pharma & Medical Distribution"
 ],
 "Investment - Banking & Investment Services": [
  "Financials",
  "Capital Markets",
  "Investment Banking & Trading"
 ],
 "Aluminum": [
  "Materials",
  "Metals & Mining",
  "Aluminum"
 ],
 "Independent Power Producers": [
  "Utilities",
  "Independent Power",
  "Nuclear & Merchant Power Generation"
 ],
 "Home Improvement": [
  "Consumer Discretionary",
  "Specialty Retail",
  "Home Improvement Retail"
 ],
 "Diversified Utilities": [
  "Utilities",
  "Multi-Utilities",
  "Regulated Electric & Gas"
 ],
 "Media & Entertainment": [
  "Communication Services",
  "Media & Entertainment",
  "Diversified Entertainment (Studios, Networks, Parks)"
 ],
 "Banks - Diversified": [
  "Financials",
  "Banks",
  "Money-Center & Universal Banks"
 ],
 "Food Confectioners": [
  "Consumer Staples",
  "Food Products",
  "Packaged Foods & Confectionery"
 ],
 "Asset Management - Cryptocurrency": [
  "Financials",
  "Digital Assets",
  "Crypto Treasury Companies"
 ],
 "Asset Management - Global": [
  "Financials",
  "Capital Markets",
  "Traditional Asset Managers"
 ],
 "Oil & Gas Integrated": [
  "Energy",
  "Integrated Oil & Gas",
  "Integrated Majors"
 ],
 "Real Estate - Diversified": [
  "Real Estate",
  "Net-Lease REITs",
  "Single-Tenant Net Lease"
 ],
 "Medical - Equipment & Services": [
  "Health Care",
  "Medical Devices",
  "Medical Consumables, Sterilization & Packaging"
 ],
 "Copper": [
  "Materials",
  "Metals & Mining",
  "Copper Mining"
 ],
 "Software - Services": [
  "Information Technology",
  "Software",
  "Vertical & Industry Software"
 ],
 "Electrical Equipment & Parts ": [
  "Industrials",
  "Electrical Equipment",
  "Electrical & Power Distribution Equipment"
 ],
 "Home Improvement ": [
  "Consumer Discretionary",
  "Specialty Retail",
  "Home Improvement Retail"
 ],
 "Telecommunications Services ": [
  "Communication Services",
  "Telecommunication Services",
  "Wireless & Wireline Carriers"
 ],
 "Biotechnology": [
  "Health Care",
  "Biotechnology",
  "Clinical-Stage / Pre-Commercial Biotech"
 ],
 "Internet Content & Information": [
  "Communication Services",
  "Social & Community Platforms",
  "Online Content & Information Platforms"
 ],
 "Medical - Healthcare Information Services": [
  "Health Care",
  "Health Care Technology",
  "Healthcare IT & Data Services"
 ],
 "Education & Training Services": [
  "Consumer Discretionary",
  "Diversified Consumer Services",
  "Education & Training Services"
 ],
 "Leisure": [
  "Consumer Discretionary",
  "Leisure Products",
  "Sporting Goods & Recreational Equipment"
 ],
 "REIT - Office": [
  "Real Estate",
  "Office REITs",
  "Office Properties"
 ],
 "Industrial Materials": [
  "Materials",
  "Metals & Mining",
  "Industrial Materials & Minerals"
 ],
 "Security & Protection Services": [
  "Industrials",
  "Commercial Services",
  "Security & Alarm Services"
 ],
 "Renewable Utilities": [
  "Utilities",
  "Independent Power",
  "Renewable Power Producers"
 ],
 "Auto - Recreational Vehicles": [
  "Consumer Discretionary",
  "Leisure Products",
  "Recreational Vehicles & Marine"
 ],
 "Coal": [
  "Energy",
  "Coal & Consumable Fuels",
  "Coal Producers"
 ],
 "Oil & Gas Drilling": [
  "Energy",
  "Oil & Gas Services",
  "Drilling Contractors"
 ],
 "REIT - Specialty": [
  "Real Estate",
  "Specialty REITs",
  "Diversified Specialty Properties"
 ],
 "Uranium": [
  "Energy",
  "Coal & Consumable Fuels",
  "Uranium"
 ],
 "Real Estate - Development": [
  "Real Estate",
  "Real Estate Services",
  "Real Estate Development"
 ],
 "Shell Companies": [
  "Financials",
  "Diversified Financials",
  "Blank-Check & Shell Companies"
 ],
 "Industrial - Pollution & Treatment Controls": [
  "Industrials",
  "Environmental Services",
  "Pollution & Treatment Controls"
 ],
 "Personal Products & Services": [
  "Consumer Discretionary",
  "Diversified Consumer Services",
  "Personal Services"
 ],
 "Business Equipment & Supplies": [
  "Industrials",
  "Commercial Services",
  "Office & Business Equipment"
 ],
 "Manufacturing - Textiles": [
  "Consumer Discretionary",
  "Apparel, Footwear & Luxury",
  "Textiles"
 ],
 "Manufacturing - Miscellaneous": [
  "Industrials",
  "Machinery",
  "Diversified Manufacturing"
 ]
};

/** Biotechnology splits on size: large companies are commercial-stage, the small-cap tail is clinical-stage. */
export const BIOTECH_COMMERCIAL_CAP_USD = 2e9;
export const BIOTECH_COMMERCIAL = ["Health Care", "Biotechnology", "Commercial-Stage Biotech"];

export function usRuleFor(fmpIndustry, capUsd) {
  if (!fmpIndustry) return null;
  if (fmpIndustry === "Biotechnology" && capUsd != null && capUsd >= BIOTECH_COMMERCIAL_CAP_USD) return BIOTECH_COMMERCIAL;
  return Object.prototype.hasOwnProperty.call(US_INDUSTRY_RULES, fmpIndustry) ? US_INDUSTRY_RULES[fmpIndustry] : null;
}

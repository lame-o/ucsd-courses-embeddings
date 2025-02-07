// index.ts
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAI } from 'openai';
import Airtable from 'airtable';
import { Course, Section, CourseDescription, VectorizedCourse } from './types';
import dotenv from 'dotenv';

dotenv.config();

// Helper functions for day and time processing
function expandDays(days: string): string[] {
  const dayMap: { [key: string]: string } = {
    'M': 'Monday',
    'Tu': 'Tuesday',
    'W': 'Wednesday',
    'Th': 'Thursday',
    'F': 'Friday'
  };
  // Split into individual days (handles MWF, TuTh etc)
  const expanded = [];
  let i = 0;
  while (i < days.length) {
    if (i < days.length - 1 && days.substring(i, i + 2) === 'Tu') {
      expanded.push('Tuesday');
      i += 2;
    } else if (i < days.length - 1 && days.substring(i, i + 2) === 'Th') {
      expanded.push('Thursday');
      i += 2;
    } else {
      const current = days[i];
      if (dayMap[current]) {
        expanded.push(dayMap[current]);
      }
      i++;
    }
  }
  return expanded;
}

function getTimeOfDay(time: string): string {
  const [timeStr, ampm] = time.split(/([ap])/i);
  const [hours] = timeStr.split(':').map(Number);
  const isPM = ampm.toLowerCase() === 'p';
  const hour24 = isPM ? (hours === 12 ? 12 : hours + 12) : (hours === 12 ? 0 : hours);
  
  if (hour24 < 12) return 'morning';
  if (hour24 < 17) return 'afternoon';
  return 'evening';
}

function parseTimeRange(time: string): { start: number; end: number } {
  const [start, end] = time.split('-');
  const parseTime = (t: string) => {
    const [timeStr, ampm] = t.split(/([ap])/i);
    const [hours, minutes = 0] = timeStr.split(':').map(Number);
    const isPM = ampm.toLowerCase() === 'p';
    return (isPM ? (hours === 12 ? 12 : hours + 12) : (hours === 12 ? 0 : hours)) * 60 + Number(minutes);
  };
  return {
    start: parseTime(start),
    end: parseTime(end)
  };
}

function getMinifiedRecord(record: any) {
  return {
    id: record.id,
    ...record.fields,
  }
}

function getMinifiedRecords(records: ReadonlyArray<any> | any[]) {
  return records.map((record) => getMinifiedRecord(record))
}

// Create Airtable instances
const mainAirtable = new Airtable({
  apiKey: process.env.NEXT_PUBLIC_AIRTABLE_API_KEY
});

const descriptionsAirtable = new Airtable({
  apiKey: process.env.NEXT_PUBLIC_AIRTABLE_Descriptions_API_KEY
});

// Create base instances
const coursesBase = mainAirtable.base(process.env.NEXT_PUBLIC_AIRTABLE_BASE_ID_Courses!);
const sectionsBase = mainAirtable.base(process.env.NEXT_PUBLIC_AIRTABLE_BASE_ID_Sections!);
const descriptionsBase = descriptionsAirtable.base(process.env.NEXT_PUBLIC_AIRTABLE_BASE_ID_Descriptions!);

// Get table references
const sectionsTable = sectionsBase(process.env.NEXT_PUBLIC_AIRTABLE_TABLE_NAME_Sections!);
const coursesTable = coursesBase(process.env.NEXT_PUBLIC_AIRTABLE_TABLE_NAME_Courses!);
const descriptionsTable = descriptionsBase(process.env.NEXT_PUBLIC_AIRTABLE_TABLE_NAME_Descriptions!);

async function fetchAndFilterData() {
  try {
    console.log('Fetching courses...');
    const courseRecords = await coursesTable.select({}).all();
    const courses = getMinifiedRecords([...courseRecords]) as Course[];
    console.log(`Found ${courses.length} courses`);
    
    // Debug course data
    console.log('\nExample course record:');
    console.log(JSON.stringify(courses[0], null, 2));
    
    console.log('Fetching sections...');
    const allSectionRecords = await sectionsTable.select({}).all();
    const allSections = getMinifiedRecords([...allSectionRecords]) as Section[];
    console.log(`Found ${allSections.length} total sections`);

    // Filter sections first
    const validSections = allSections.filter(section => 
      section["Meeting Type"] === 'Lecture' && (!section["Building"] || !section["Building"].includes('RCLAS'))
    );
    console.log(`Found ${validSections.length} valid lecture sections (excluding RCLAS)`);

    // Get valid courses (not labs) that have valid sections
    const validCourses = courses.filter(course => {
      const hasValidSection = validSections.some(section => {
        const sectionCourseId = Array.isArray(section["Course Link"]) ? section["Course Link"][0] : section["Course Link"];
        return sectionCourseId === course.id;
      });
      const notLab = !course["Course Name"]?.toLowerCase().includes('lab') && 
                    !course["Course Name"]?.toLowerCase().includes('laboratory');
      return hasValidSection && notLab;
    });
    console.log(`Found ${validCourses.length} valid courses (excluding labs)`);

    // Get descriptions and match them with courses
    console.log('Fetching course descriptions...');
    const descriptionRecords = await descriptionsTable.select({}).all();
    const descriptions = getMinifiedRecords([...descriptionRecords]) as CourseDescription[];
    console.log(`Found ${descriptions.length} course descriptions`);

    // Combine everything into final format
    const vectorizedCourses: VectorizedCourse[] = [];
    
    for (const course of validCourses) {
      const courseCode = `${course["Subject Code"]} ${course["Course Number"]}`;
      const description = descriptions.find(d => d.code === courseCode);
      
      if (!description) {
        console.log(`No description found for course: ${courseCode}`);
        continue;
      }

      // Debug title information
      console.log(`\nProcessing ${courseCode}:`);
      console.log('Title from description:', description.title);
      console.log('Course name from Airtable:', course["Course Name"]);

      const courseSections = validSections.filter(section => {
        const sectionCourseId = Array.isArray(section["Course Link"]) ? section["Course Link"][0] : section["Course Link"];
        return sectionCourseId === course.id;
      });

      for (const section of courseSections) {
        vectorizedCourses.push({
          id: `${description.id}-${section.id}`,
          code: description.code,
          title: description.title || course["Course Name"], // Fallback to Course Name if title is missing
          description: description.description,
          prerequisites: description.prerequisites,
          metadata: {
            units: description.units,
            department: course["Subject Code"],
            courseNumber: course["Course Number"],
            instructor: section["Instructor"],
            time: section["Time"],
            building: section["Building"],
            room: section["Room"],
            days: section["Days"],
            availableSeats: section["Available Seats"],
            seatLimit: section["Seat Limit"],
            title: description.title || course["Course Name"], // Also include title in metadata
            code: courseCode
          }
        });
      }
    }

    console.log(`\nProcessed ${vectorizedCourses.length} course sections for vectorization`);
    console.log('\nFirst 5 processed courses:');
    console.log(JSON.stringify(vectorizedCourses.slice(0, 5), null, 2));
    
    return vectorizedCourses;

  } catch (error) {
    console.error('Error processing data:', error);
    throw error;
  }
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });
  return response.data[0].embedding;
}

async function uploadToPinecone(vectorizedCourses: VectorizedCourse[]) {
  console.log('\nGenerating embeddings and uploading to Pinecone...');
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!
  });
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
  
  // Process in batches of 100 to avoid rate limits
  const batchSize = 100;
  for (let i = 0; i < vectorizedCourses.length; i += batchSize) {
    const batch = vectorizedCourses.slice(i, i + batchSize);
    const vectors = await Promise.all(
      batch.map(async (course) => {
        // Create metadata with expanded time and day information
        const expandedDays = expandDays(course.metadata.days);
        const timeOfDay = getTimeOfDay(course.metadata.time);
        const timeRange = parseTimeRange(course.metadata.time);
        
        const metadata = {
          ...course.metadata,
          code: course.code,
          title: course.title,
          description: course.description,
          prerequisites: course.prerequisites || '',
          expandedDays,
          timeOfDay,
          timeStart: timeRange.start,
          timeEnd: timeRange.end
        };

        // Create a rich text representation for embedding
        const textForEmbedding = `
          Course: ${course.code}: ${course.title}
          This lecture has a capacity of ${course.metadata.seatLimit} students.
          Schedule: This class meets on ${expandedDays.join(' and ')} 
          during the ${timeOfDay} at ${course.metadata.time}.
          Location: ${course.metadata.building} ${course.metadata.room}
          Instructor: ${course.metadata.instructor}
          Description: ${course.description}
          Prerequisites: ${course.prerequisites || 'None'}
          Department: ${course.metadata.department}
          Units: ${course.metadata.units}
        `.trim().replace(/\n\s+/g, ' ');
        
        const embedding = await generateEmbedding(textForEmbedding);
        
        // Debug title
        console.log(`Processing ${course.code} - Title: ${course.title}`);
        
        return {
          id: course.id,
          values: embedding,
          metadata: metadata
        };
      })
    );
    
    await index.upsert(vectors);
    console.log(`Uploaded ${i + vectors.length} / ${vectorizedCourses.length} courses`);
  }
  console.log('Upload complete!');
}

async function searchCourses(query: string, filters?: { building?: string; days?: string; timeOfDay?: string }) {
  console.log(`\nSearching for: "${query}"`);
  if (filters) {
    console.log('Filters:', filters);
  }

  // Parse the query for time and day information
  const timeKeywords = ['morning', 'afternoon', 'evening'];
  const dayKeywords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  
  const queryLower = query.toLowerCase();
  let timeFilter: string | undefined;
  let dayFilter: string | undefined;

  // Extract time of day from query
  for (const time of timeKeywords) {
    if (queryLower.includes(time)) {
      timeFilter = time;
      break;
    }
  }

  // Extract day from query
  for (const day of dayKeywords) {
    if (queryLower.includes(day)) {
      dayFilter = day.charAt(0).toUpperCase() + day.slice(1);
      break;
    }
  }

  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!
  });
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(query);

  // Build filter conditions
  const filterConditions: any = {};
  if (dayFilter) {
    filterConditions.expandedDays = { $in: [dayFilter] };
  }
  if (timeFilter) {
    filterConditions.timeOfDay = timeFilter;
  }
  if (filters?.building) {
    filterConditions.building = filters.building;
  }

  // Search in Pinecone
  const results = await index.query({
    vector: queryEmbedding,
    topK: 5,
    filter: Object.keys(filterConditions).length > 0 ? filterConditions : undefined,
    includeMetadata: true
  });

  // Format and display results
  console.log('\nSearch Results:');
  results.matches.forEach((match, i) => {
    const metadata = match.metadata as any;
    const score = typeof match.score === 'number' ? match.score : 0;
    console.log(`\n${i + 1}. ${metadata.code}: ${metadata.title || 'No title'} (Score: ${score.toFixed(3)})`);
    console.log(`   Time: ${metadata.days} ${metadata.time} in ${metadata.building} ${metadata.room}`);
    console.log(`   Instructor: ${metadata.instructor}`);
    console.log(`   Available Seats: ${metadata.availableSeats}/${metadata.seatLimit}`);
    if (metadata.description) {
      console.log(`   Description: ${metadata.description.slice(0, 200)}...`);
    }
    if (metadata.prerequisites) {
      console.log(`   Prerequisites: ${metadata.prerequisites}`);
    }
  });
}

async function deleteAllVectors() {
  console.log('Deleting all vectors from Pinecone...');
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!
  });
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
  
  // Delete all vectors
  await index.deleteAll();
  console.log('All vectors deleted from index');
}

async function main() {
  try {
    // First delete all existing vectors
    await deleteAllVectors();
    
    console.log('\nFetching and processing course data...');
    const vectorizedCourses = await fetchAndFilterData();
    
    if (vectorizedCourses.length > 0) {
      console.log('\nUploading courses to Pinecone with updated embeddings...');
      await uploadToPinecone(vectorizedCourses);
      console.log('Upload complete!');
      
      // Test various schedule and size queries
      console.log('\nTesting search with new embeddings:');
      await searchCourses("music classes on wednesday");
      console.log('\n-------------------\n');
      await searchCourses("computer science classes that meet on friday");
      console.log('\n-------------------\n');
      await searchCourses("large astrology classes in the afternoon");
    }
  } catch (error) {
    console.error('Failed to process data:', error);
  }
}

main();
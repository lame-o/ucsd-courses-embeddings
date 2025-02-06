export interface Course {
  id: string;
  "Course Number": string;
  "Subject Code": string;
  "Course Name": string;
  "Units": string;
  "Sections": string[];
}

export interface Section {
  id: string;
  "Subject Code": string;
  "Course Link": string | string[];
  "Meeting Type": string;
  "Time": string;
  "Building": string;
  "Room": string;
  "Instructor": string;
  "Available Seats": number;
  "Seat Limit": number;
  "Days": string;
  "Section ID": string;
}

export interface CourseDescription {
  id: string;
  code: string;
  title: string;
  units: number;
  description: string;
  prerequisites: string;
}

// Final structure we'll upload to Pinecone
export interface VectorizedCourse {
  id: string;
  code: string;
  title: string;
  description: string;
  prerequisites?: string;
  metadata: {
    units: string | number;
    department: string;  // Extracted from code (e.g., "CSE" from "CSE 101")
    courseNumber: string;  // Extracted from code (e.g., "101" from "CSE 101")
    instructor: string;
    time: string;
    building: string;
    room: string;
    days: string;
    availableSeats: number;
    seatLimit: number;  // Changed from string to number to match Airtable
    title: string;  // Added title to metadata
    code: string;   // Added code to metadata
  };
}